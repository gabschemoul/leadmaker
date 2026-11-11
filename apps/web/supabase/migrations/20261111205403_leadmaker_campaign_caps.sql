-- Plafonds d'une campagne (11/11/2026, demande de Gabriel) : maximum de prospects gardés payés et maximum de crédits
-- dépensés, fixés dans les paramètres avancés ; la campagne se met en pause (« cap_reached ») en les atteignant.
-- Compatible avec main : colonnes vides par défaut (pas de plafond), mêmes signatures.

alter table "public"."lm_campaigns" add column "max_credits" integer;

alter table "public"."lm_campaigns" add column "max_kept" integer;

alter table "public"."lm_campaigns" add constraint "lm_campaigns_max_credits_positive" CHECK (((max_credits IS NULL) OR (max_credits > 0))) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_max_credits_positive";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_max_kept_positive" CHECK (((max_kept IS NULL) OR (max_kept > 0))) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_max_kept_positive";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_cap_reached(p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
           (c.max_kept is not null
            and (select count(*) from public.lm_campaign_prospects cp
                  where cp.campaign_id = c.id and cp.paid_at is not null
                    and coalesce(cp.client_choice, cp.verdict) = 'gardee') >= c.max_kept)
           or (c.max_credits is not null
               and (select coalesce(sum(cp.credits), 0) from public.lm_campaign_prospects cp
                     where cp.campaign_id = c.id and cp.paid_at is not null)
                   + greatest(c.credits_per_prospect, 1) > c.max_credits),
           false)
    from public.lm_campaigns c
   where c.id = p_campaign_id;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_set_campaign_caps(p_campaign_id uuid, p_max_kept integer, p_max_credits integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if (p_max_kept is not null and p_max_kept <= 0) or (p_max_credits is not null and p_max_credits <= 0) then
    raise exception 'invalid cap' using errcode = 'P0001', hint = 'invalid_cap';
  end if;

  update public.lm_campaigns set max_kept = p_max_kept, max_credits = p_max_credits where id = p_campaign_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_duplicate_campaign(p_campaign_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source public.lm_campaigns%rowtype;
  v_id uuid;
begin
  select * into v_source from public.lm_campaigns where id = p_campaign_id;

  if v_source.id is null or not public.lm_member(v_source.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  -- offre propre à la campagne et groupes fins recopiés (10/11/2026), plafonds aussi (11/11/2026)
  insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters, templates,
                                   daily_limit, auto_validation, sender_id, offer, sort_groups_fine, max_kept, max_credits)
  values (v_source.account_id, v_source.space_id, left(p_name, 255), v_source.country_code, v_source.targeting,
          v_source.filters - 'paused_reason', v_source.templates, v_source.daily_limit,
          v_source.auto_validation and public.lm_auto_validation_allowed(v_source.account_id), v_source.sender_id,
          v_source.offer, v_source.sort_groups_fine, v_source.max_kept, v_source.max_credits)
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_settle_kept(p_campaign_id uuid, p_prospect_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_count integer := 0;
  r record;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  -- 11/11/2026 (Gabriel, choix 2) : un gardé est payé tout de suite, même pendant la mesure du prix, au tarif du
  -- moment (1 crédit au départ) ; une fois le prix mesuré, les suivants le sont au prix mesuré. Avant, les gardés
  -- attendaient 300 triés pour être payés, donc contactables (« 3 à contacter » sur 69 gardés).
  if v_campaign.id is null then
    return 0;
  end if;

  -- Solde de l'organisation verrouillé AVANT de regarder si l'entreprise est déjà payée ailleurs : deux règlements
  -- simultanés de la même entreprise dans deux campagnes (robot de tri + recharge qui règle l'attente) se suivent
  -- au lieu de la débiter deux fois (relecture du 11/11/2026)
  perform 1 from public.lm_account_credits where account_id = v_campaign.account_id for update;

  for r in
    select cp.prospect_id,
           exists (select 1 from public.lm_campaign_prospects o
                    where o.prospect_id = cp.prospect_id and o.campaign_id <> cp.campaign_id
                      and o.paid_at is not null) as already_paid
      from public.lm_campaign_prospects cp
     where cp.campaign_id = p_campaign_id
       and (p_prospect_id is null or cp.prospect_id = p_prospect_id)
       and cp.paid_at is null
       and coalesce(cp.client_choice, cp.verdict) = 'gardee'
     order by cp.sorted_at nulls last
     for update of cp skip locked
  loop
    -- plafond fixé par le client atteint : on s'arrête là, la campagne se met en pause (11/11/2026)
    if not r.already_paid and public.lm_campaign_cap_reached(p_campaign_id) then
      perform public.lm_pause_campaign(p_campaign_id, 'cap_reached');
      exit;
    end if;

    if not r.already_paid
       and not public.lm_debit_credits(v_campaign.account_id, 'discovery', greatest(v_campaign.credits_per_prospect, 1),
                                       'keep:' || p_campaign_id::text || ':' || r.prospect_id::text, 'kept',
                                       p_campaign_id) then
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      exit;
    end if;

    update public.lm_campaign_prospects
       set paid_at = now(), credits = case when r.already_paid then 0 else greatest(v_campaign.credits_per_prospect, 1) end
     where campaign_id = p_campaign_id and prospect_id = r.prospect_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_start_campaign(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_limit integer;
  v_running integer;
  v_balance integer;
  v_estimate_id uuid;
  v_credits integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_campaign.status = 'running' then
    return;
  end if;

  if v_campaign.status = 'archived' then
    raise exception 'campaign archived' using errcode = 'P0001', hint = 'archived';
  end if;

  -- plafond fixé par le client déjà atteint : il faut le monter avant de reprendre (11/11/2026)
  if public.lm_campaign_cap_reached(p_campaign_id) then
    raise exception 'campaign cap reached' using errcode = 'P0001', hint = 'cap_reached';
  end if;

  select p.active_campaigns, c.discovery_balance + public.lm_pack_credits(c.account_id) into v_limit, v_balance
    from public.lm_account_credits c left join public.lm_plans p on p.id = c.plan_id
   where c.account_id = v_campaign.account_id;

  if v_balance is null or v_balance <= 0 then
    raise exception 'no discovery credits' using errcode = 'P0001', hint = 'no_credits';
  end if;

  -- un lancement à la fois par organisation : deux lancements simultanés ne dépassent pas le quota (audit A14)
  perform pg_advisory_xact_lock(hashtext('lm_start_campaign:' || v_campaign.account_id::text));

  select count(*) into v_running from public.lm_campaigns
   where account_id = v_campaign.account_id and status = 'running';

  if v_limit is not null and v_running >= v_limit then
    raise exception 'active campaign limit reached' using errcode = 'P0001', hint = 'campaign_limit';
  end if;

  -- Premier lancement : on fige les villes, les catégories et le tarif (crédits par prospect)
  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    -- Campagne avec une cible en mots : son prix se mesure sur les entreprises triées (lm_measure_sort_price).
    -- Plus de recherches d'essai pour elle (11/11/2026) : elles passaient avant ses vraies recherches dans la file
    -- des robots (1 à 2 minutes de « 0 recherche faite »), et leurs fiches étaient jetées puis recherchées à nouveau.
    if nullif(trim(v_campaign.sort_target), '') is null then
      -- Le tarif vient de l'estimation faite avec exactement ce ciblage et ces filtres (roadmap n°13).
      -- Audit A7 : la PLUS CHÈRE des 7 derniers jours (sinon relancer l'estimation jusqu'à tomber sur un
      -- échantillon favorable faisait baisser le tarif).
      select e.id, e.credits_per_prospect into v_estimate_id, v_credits
        from public.lm_estimates e
       where e.account_id = v_campaign.account_id and e.status = 'done'
         and e.created_at > now() - interval '7 days'
         and e.country_code = v_campaign.country_code
         and e.targeting = v_campaign.targeting
         and e.filters = (v_campaign.filters - 'paused_reason')
       order by e.credits_per_prospect desc nulls last, e.created_at desc
       limit 1;

      if v_estimate_id is not null then
        update public.lm_campaigns
           set credits_per_prospect = coalesce(v_credits, 1), estimate_id = v_estimate_id, price_pending = false
         where id = p_campaign_id;
      else
        -- 4/11/2026 : plus aucune attente avant le lancement. Sans estimation terminée, la campagne part tout
        -- de suite à 1 crédit par prospect ; la mesure (celle en cours, sinon une nouvelle) tourne en parallèle
        -- et fixe le tarif quand elle se termine (lm_record_estimate_search).
        select e.id into v_estimate_id
          from public.lm_estimates e
         where e.account_id = v_campaign.account_id and e.status = 'running'
           and e.country_code = v_campaign.country_code
           and e.targeting = v_campaign.targeting
           and e.filters = (v_campaign.filters - 'paused_reason')
         order by e.created_at desc
         limit 1
           for update;

        if v_estimate_id is null then
          v_estimate_id := public.lm_create_estimate(v_campaign.account_id, v_campaign.country_code,
                                                     v_campaign.targeting, v_campaign.filters - 'paused_reason');
        end if;

        update public.lm_campaigns
           set credits_per_prospect = 1, estimate_id = v_estimate_id, price_pending = true
         where id = p_campaign_id;
      end if;
    end if;

    -- Ordre de passage : chaque ville par son nom (des plus peuplées aux moins peuplées), puis les secteurs
    -- des grandes villes en alternant les villes
    insert into public.lm_campaign_zones (campaign_id, idx, pos, account_id, geoname_id, label, population,
                                          latitude, longitude, zoom)
      select p_campaign_id, z.rn - 1, z.rn - 1,
             v_campaign.account_id, z.geoname_id, z.label, z.population, z.latitude, z.longitude, z.zoom
        from (select t.*, row_number() over (
                       order by t.latitude is not null, coalesce(substring(t.label from ' · ([0-9]+)$')::integer, 0),
                                t.population desc, t.geoname_id, t.label) as rn
                from public.lm_target_zones(v_campaign.country_code, v_campaign.targeting) t) z;

    insert into public.lm_campaign_categories (campaign_id, gcid, account_id, is_generic)
      select p_campaign_id, t.gcid, v_campaign.account_id, t.is_generic
        from public.lm_target_categories(v_campaign.targeting) t;
  end if;

  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    raise exception 'no city matches the targeting' using errcode = 'P0001', hint = 'no_cities';
  end if;

  -- Reprise après une pause : les recherches annulées repartent
  update public.lm_tasks set status = 'queued', run_after = now(), finished_at = null, attempts = 0, error = null
   where kind = 'discovery' and status = 'cancelled' and payload ->> 'campaign_id' = p_campaign_id::text;

  -- Les places occupées repartent des vraies tâches en file ou en cours
  perform public.lm_recount_in_flight(p_campaign_id);

  update public.lm_campaigns
     set status = 'running', filters = filters - 'paused_reason'
   where id = p_campaign_id;
end;
$function$
;



-- Droits des fonctions (db diff ne les écrit pas)
revoke all on function public.lm_campaign_cap_reached(uuid) from public;
grant execute on function public.lm_campaign_cap_reached(uuid) to service_role;
revoke all on function public.lm_set_campaign_caps(uuid, integer, integer) from public;
grant execute on function public.lm_set_campaign_caps(uuid, integer, integer) to authenticated, service_role;
