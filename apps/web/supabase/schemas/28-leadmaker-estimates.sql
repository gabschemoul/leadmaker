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
create or replace function public.lm_request_estimate(p_account_id uuid, p_country_code text, p_targeting jsonb,
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
  if not public.has_role_on_account(p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  -- Une seule estimation à la fois par organisation : la précédente est abandonnée
  update public.lm_estimates set status = 'failed', finished_at = now()
   where account_id = p_account_id and status = 'running';

  update public.lm_tasks set status = 'cancelled', finished_at = now()
   where kind = 'estimate' and status = 'queued' and account_id = p_account_id;

  select count(*) into v_zones from public.lm_target_zones(p_country_code, p_targeting);
  select count(*) into v_categories from public.lm_target_categories(p_targeting);
  v_total := v_zones * v_categories;

  if v_total = 0 then
    raise exception 'nothing to estimate' using errcode = 'P0001', hint = 'no_cities';
  end if;

  v_mode := case when v_total <= v_sample then 'exact' else 'sample' end;

  insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, total_searches, sample_searches)
  values (p_account_id, upper(p_country_code), p_targeting, coalesce(p_filters, '{}'), v_mode, v_total,
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

revoke all on function public.lm_request_estimate(uuid, text, jsonb, jsonb) from public;

-- Résultat d'une recherche d'estimation (worker) ; calcule le total quand toutes les recherches sont lues
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
end;
$$;

revoke all on function public.lm_record_estimate_search(uuid, integer, text[], boolean) from public;

-- Recherche d'estimation abandonnée (échecs répétés) : comptée comme lue sans résultat
create or replace function public.lm_skip_estimate_search(p_estimate_id uuid) returns void
set search_path = ''
language sql
security definer
as $$
  select public.lm_record_estimate_search(p_estimate_id, 0, '{}'::text[], false);
$$;

revoke all on function public.lm_skip_estimate_search(uuid) from public;
