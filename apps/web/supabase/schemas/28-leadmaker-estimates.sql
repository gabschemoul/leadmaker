/*
 * -------------------------------------------------------
 * Section: LeadMaker estimates
 * Estimation réelle d'une campagne avant lancement : le worker lit les listes Google Maps
 * (sans ouvrir les fiches, sans crédit) et compte les entreprises qui passent les filtres.
 * - mode exact : 30 recherches ou moins, tout est lu, entreprises dédoublonnées → chiffre exact
 * - mode échantillon : 30 recherches tirées au hasard, extrapolées au nombre total de recherches,
 *   corrigées du recouvrement entre recherches voisines (mesuré sur les campagnes passées)
 * -------------------------------------------------------
 */
create table if not exists public.lm_estimates (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  country_code char(2) not null,
  targeting jsonb not null,
  filters jsonb not null default '{}'::jsonb,
  mode text not null,
  status text not null default 'running',
  total_searches bigint not null,
  sample_searches integer not null,
  done_searches integer not null default 0,
  cards integer not null default 0,
  matching integer not null default 0,
  overlap numeric(5,4) not null default 1,
  expected bigint,
  expected_low bigint,
  expected_high bigint,
  -- Roadmap n°13 : part des fiches lues qui passent les filtres, et crédits par prospect qui en découlent
  rate numeric(6,4),
  credits_per_prospect integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_estimates_mode check (mode in ('exact', 'sample')),
  constraint lm_estimates_status check (status in ('running', 'done', 'failed'))
);

comment on table public.lm_estimates is 'Estimations réelles (lecture de Google Maps) demandées avant de lancer une campagne';

alter table public.lm_estimates enable row level security;

revoke all on public.lm_estimates from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_estimates to service_role;

grant select on table public.lm_estimates to authenticated;

create trigger lm_estimates_set_timestamps
  before insert or update on public.lm_estimates
  for each row execute function public.trigger_set_timestamps();

create trigger lm_estimates_set_user_tracking
  before insert or update on public.lm_estimates
  for each row execute function public.trigger_set_user_tracking();

create index if not exists ix_lm_estimates_account_id_created_at on public.lm_estimates (account_id, created_at desc);

create policy "lm_estimates_read" on public.lm_estimates for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_estimates" on public.lm_estimates
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Entreprises qui passent les filtres, par estimation (dédoublonnage entre secteurs voisins)
create table if not exists public.lm_estimate_places (
  estimate_id uuid references public.lm_estimates(id) on delete cascade not null,
  google_place_id text not null,
  primary key (estimate_id, google_place_id)
);

comment on table public.lm_estimate_places is 'Fiches Google retenues par une estimation, pour compter chaque entreprise une seule fois';

alter table public.lm_estimate_places enable row level security;

revoke all on public.lm_estimate_places from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_estimate_places to service_role;

-- Demande d'estimation réelle : crée les recherches à lire (prioritaires sur les campagnes)
-- Crée une estimation et ses recherches (robots « estimate », priorité 10). INTERNE : sans contrôle d'accès ni
-- quota ; appelée par lm_request_estimate (appli), lm_start_campaign et lm_update_campaign (mesure du tarif).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_create_estimate(p_account_id uuid, p_country_code text, p_targeting jsonb,
                                                     p_filters jsonb) returns uuid
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_total bigint;
  v_zones bigint;
  v_categories bigint;
  v_mode text;
  v_sample integer := 30;
begin
  -- Une seule estimation à la fois par organisation : la précédente est abandonnée, sauf celle qui fixera le
  -- tarif d'une campagne déjà lancée (price_pending, 4/11/2026)
  with dropped as (
    update public.lm_estimates e set status = 'failed', finished_at = now()
     where e.account_id = p_account_id and e.status = 'running'
       and not exists (select 1 from public.lm_campaigns c where c.estimate_id = e.id and c.price_pending)
    returning e.id
  )
  update public.lm_tasks t set status = 'cancelled', finished_at = now()
    from dropped d
   where t.kind = 'estimate' and t.status = 'queued' and t.account_id = p_account_id
     and t.payload ->> 'estimate_id' = d.id::text;

  select count(*) into v_zones from public.lm_target_zones(p_country_code, p_targeting);
  select count(*) into v_categories from public.lm_target_categories(p_targeting);
  v_total := v_zones * v_categories;

  if v_total = 0 then
    raise exception 'nothing to estimate' using errcode = 'P0001', hint = 'no_cities';
  end if;

  v_mode := case when v_total <= v_sample then 'exact' else 'sample' end;

  insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, total_searches, sample_searches)
  values (p_account_id, upper(p_country_code), p_targeting, public.lm_normalize_filters(p_filters), v_mode, v_total,
          least(v_total, v_sample))
  returning id into v_id;

  insert into public.lm_tasks (account_id, kind, payload, idempotency_key, priority)
  select p_account_id, 'estimate',
         jsonb_build_object('estimate_id', v_id, 'country_code', upper(p_country_code),
                            'latitude', s.latitude, 'longitude', s.longitude, 'zoom', s.zoom,
                            'geoname_id', s.geoname_id, 'category', s.label_en,
                            'is_grid', s.latitude is not null,
                            'query', case when s.latitude is null then s.label_en || ' in ' || s.label else s.label_en end),
         'estimate:' || v_id || ':' || row_number() over (),
         10
    from (
      select z.geoname_id, z.label, z.latitude, z.longitude, z.zoom, cat.label_en
        from public.lm_target_zones(p_country_code, p_targeting) z
       cross join public.lm_target_categories(p_targeting) c
        join public.lm_categories cat on cat.gcid = c.gcid
       where v_mode = 'exact'
      union all
      select z.geoname_id, z.label, z.latitude, z.longitude, z.zoom,
             (select cat.label_en from public.lm_target_categories(p_targeting) c
                join public.lm_categories cat on cat.gcid = c.gcid
               where z.label is not null
               order by random() limit 1)
        from (select * from public.lm_target_zones(p_country_code, p_targeting) order by random() limit v_sample) z
       where v_mode = 'sample'
    ) s;

  return v_id;
end;
$$;

revoke all on function public.lm_create_estimate(uuid, text, jsonb, jsonb) from public;

grant execute on function public.lm_create_estimate(uuid, text, jsonb, jsonb) to service_role;

-- Estimation demandée depuis l'appli (bouton « Estimer » du formulaire de campagne).
-- Audit A3 : chaque estimation coûte jusqu'à 30 recherches de proxy, payées par Prospectigo. Quota par
-- organisation sur 24 h : 40 avec un forfait, 3 sans (pour découvrir l'outil avant de payer).
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_request_estimate(p_account_id uuid, p_country_code text, p_targeting jsonb,
                                                      p_filters jsonb) returns uuid
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_recent integer;
  v_quota integer;
begin
  if not public.lm_member(p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  -- une demande à la fois par organisation (deux clics simultanés ne doublent pas le quota)
  perform pg_advisory_xact_lock(hashtext('lm_request_estimate:' || p_account_id::text));

  select count(*) into v_recent from public.lm_estimates
   where account_id = p_account_id and created_at > now() - interval '24 hours';

  v_quota := 3;

  if public.lm_has_plan(p_account_id) then
    v_quota := 40;
  end if;

  if v_recent >= v_quota then
    raise exception 'estimate quota reached' using errcode = 'P0001', hint = 'estimate_quota';
  end if;

  return public.lm_create_estimate(p_account_id, p_country_code, p_targeting, p_filters);
end;
$$;

revoke all on function public.lm_request_estimate(uuid, text, jsonb, jsonb) from public;

grant execute on function public.lm_request_estimate(uuid, text, jsonb, jsonb) to authenticated, service_role;

-- Résultat d'une recherche d'estimation (worker) ; calcule le total quand toutes les recherches sont lues
-- Appelant : interne (appelée par d'autres fonctions SQL).
create or replace function public.lm_record_estimate_search(p_estimate_id uuid, p_cards integer, p_place_ids text[],
                                                            p_is_grid boolean) returns void
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_est public.lm_estimates%rowtype;
  v_new integer;
  v_overlap numeric;
begin
  select * into v_est from public.lm_estimates where id = p_estimate_id for update;

  if v_est.id is null or v_est.status <> 'running' then
    return;
  end if;

  with ins as (
    insert into public.lm_estimate_places (estimate_id, google_place_id)
    select p_estimate_id, unnest(p_place_ids)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_new from ins;

  update public.lm_estimates
     set done_searches = done_searches + 1,
         cards = cards + p_cards,
         matching = matching + coalesce(array_length(p_place_ids, 1), 0)
   where id = p_estimate_id
  returning * into v_est;

  if v_est.done_searches < v_est.sample_searches then
    return;
  end if;

  -- Difficulté : part des fiches lues qui passent les filtres → crédits par prospect (roadmap n°13)
  update public.lm_estimates
     set rate = round(case when v_est.cards > 0 then v_est.matching::numeric / v_est.cards else 0 end, 4),
         credits_per_prospect = public.lm_credits_for_rate(
           case when v_est.cards > 0 then v_est.matching::numeric / v_est.cards end)
   where id = p_estimate_id;

  if v_est.mode = 'exact' then
    update public.lm_estimates
       set status = 'done', finished_at = now(), overlap = 1,
           expected = (select count(*) from public.lm_estimate_places where estimate_id = p_estimate_id),
           expected_low = (select count(*) from public.lm_estimate_places where estimate_id = p_estimate_id),
           expected_high = (select count(*) from public.lm_estimate_places where estimate_id = p_estimate_id)
     where id = p_estimate_id;
  else
    -- Recouvrement entre recherches voisines : part de fiches nouvelles mesurée sur les campagnes passées
    select case when sum(s.cards_seen) >= 2000 then sum(s.cards_new)::numeric / sum(s.cards_seen) end
      into v_overlap from public.lm_searches s;
    v_overlap := coalesce(v_overlap, 0.45);

    update public.lm_estimates
       set status = 'done', finished_at = now(), overlap = round(v_overlap, 4),
           expected = round(v_est.matching::numeric / v_est.sample_searches * v_est.total_searches * v_overlap),
           expected_low = round(v_est.matching::numeric / v_est.sample_searches * v_est.total_searches * v_overlap * 0.7),
           expected_high = round(v_est.matching::numeric / v_est.sample_searches * v_est.total_searches * v_overlap * 1.3)
     where id = p_estimate_id;
  end if;

  -- Campagnes lancées sans attendre cette mesure (4/11/2026) : leur tarif est fixé maintenant, pour la suite
  update public.lm_campaigns c
     set credits_per_prospect = coalesce(e.credits_per_prospect, 1), price_pending = false
    from public.lm_estimates e
   where e.id = p_estimate_id and c.estimate_id = p_estimate_id and c.price_pending;
end;
$$;

revoke all on function public.lm_record_estimate_search(uuid, integer, text[], boolean) from public;

-- Recherche d'estimation abandonnée (échecs répétés) : comptée comme lue sans résultat
-- Appelant : interne (appelée par d'autres fonctions SQL).
create or replace function public.lm_skip_estimate_search(p_estimate_id uuid) returns void
set search_path = ''
language sql
security definer
as $$
  select public.lm_record_estimate_search(p_estimate_id, 0, '{}'::text[], false);
$$;

revoke all on function public.lm_skip_estimate_search(uuid) from public;

-- Tarif d'une campagne, lisible par ses membres : figé si elle a déjà été lancée, sinon celui de la dernière
-- estimation faite avec exactement son ciblage et ses filtres (terminée, en cours ou aucune).
-- Lancée pendant la mesure (price_pending, 4/11/2026) : l'avancement de sa mesure tant qu'elle tourne.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_campaign_pricing(p_campaign_id uuid)
returns table (frozen boolean, credits_per_prospect integer, rate numeric, estimate_id uuid, estimate_status text,
               done_searches integer, sample_searches integer)
set search_path = ''
language sql
stable
as $$
  with c as (
    select c.*, exists (select 1 from public.lm_campaign_zones z where z.campaign_id = c.id) as launched
      from public.lm_campaigns c where c.id = p_campaign_id
  ), e as (
    -- lancée : l'estimation qui a fixé (ou fixera) son tarif ; sinon la dernière faite avec ce ciblage
    select e.* from public.lm_estimates e, c
     where e.account_id = c.account_id
       and case when c.launched then e.id = c.estimate_id
                else e.country_code = c.country_code and e.targeting = c.targeting
                     and e.filters = (c.filters - 'paused_reason')
                     -- même choix que lm_start_campaign : la plus chère des 7 derniers jours
                     and (e.status <> 'done' or e.created_at > now() - interval '7 days') end
     order by (e.status = 'done') desc, e.credits_per_prospect desc nulls last, e.created_at desc
     limit 1
  ), x as (
    select c.*, c.launched and c.price_pending and e.status = 'running' as measuring,
           e.id as e_id, e.status as e_status, e.credits_per_prospect as e_credits, e.rate as e_rate,
           e.done_searches as e_done, e.sample_searches as e_sample
      from c left join e on true
  )
  select x.launched,
         case when x.measuring then null
              when x.launched then x.credits_per_prospect
              when x.e_status = 'done' then x.e_credits end,
         case when x.measuring then null
              when x.launched or x.e_status = 'done' then x.e_rate end,
         case when x.launched then x.estimate_id else x.e_id end,
         case when x.measuring then x.e_status when x.launched then null else x.e_status end,
         case when x.measuring or not x.launched then x.e_done end,
         case when x.measuring or not x.launched then x.e_sample end
    from x;
$$;

grant execute on function public.lm_campaign_pricing(uuid) to authenticated, service_role;

-- Lance l'estimation d'une campagne avec exactement son ciblage et ses filtres (pour fixer son tarif).
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_request_campaign_estimate(p_campaign_id uuid) returns uuid
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_campaign public.lm_campaigns%rowtype;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  return public.lm_request_estimate(v_campaign.account_id, v_campaign.country_code, v_campaign.targeting,
                                    v_campaign.filters - 'paused_reason');
end;
$$;

revoke all on function public.lm_request_campaign_estimate(uuid) from public;

grant execute on function public.lm_request_campaign_estimate(uuid) to authenticated, service_role;
