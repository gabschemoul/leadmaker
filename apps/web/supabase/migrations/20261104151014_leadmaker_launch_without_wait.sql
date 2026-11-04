alter table "public"."lm_campaigns" add column "price_pending" boolean not null default false;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_pricing(p_campaign_id uuid)
 RETURNS TABLE(frozen boolean, credits_per_prospect integer, rate numeric, estimate_id uuid, estimate_status text, done_searches integer, sample_searches integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with c as (
    select c.*, exists (select 1 from public.lm_campaign_zones z where z.campaign_id = c.id) as launched
      from public.lm_campaigns c where c.id = p_campaign_id
  ), e as (
    -- lancée : l'estimation qui a fixé (ou fixera) son tarif ; sinon la dernière faite avec ce ciblage
    select e.* from public.lm_estimates e, c
     where e.account_id = c.account_id
       and case when c.launched then e.id = c.estimate_id
                else e.country_code = c.country_code and e.targeting = c.targeting
                     and e.filters = (c.filters - 'paused_reason') end
     order by (e.status = 'done') desc, e.created_at desc
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
$function$
;

CREATE OR REPLACE FUNCTION public.lm_record_estimate_search(p_estimate_id uuid, p_cards integer, p_place_ids text[], p_is_grid boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.lm_request_estimate(p_account_id uuid, p_country_code text, p_targeting jsonb, p_filters jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_campaign.id is null or not public.has_role_on_account(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_campaign.status = 'running' then
    return;
  end if;

  select p.active_campaigns, c.discovery_balance into v_limit, v_balance
    from public.lm_account_credits c left join public.lm_plans p on p.id = c.plan_id
   where c.account_id = v_campaign.account_id;

  if v_balance is null or v_balance <= 0 then
    raise exception 'no discovery credits' using errcode = 'P0001', hint = 'no_credits';
  end if;

  select count(*) into v_running from public.lm_campaigns
   where account_id = v_campaign.account_id and status = 'running';

  if v_limit is not null and v_running >= v_limit then
    raise exception 'active campaign limit reached' using errcode = 'P0001', hint = 'campaign_limit';
  end if;

  -- Premier lancement : on fige les villes, les catégories et le tarif (crédits par prospect)
  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    -- Le tarif vient de l'estimation faite avec exactement ce ciblage et ces filtres (roadmap n°13).
    select e.id, e.credits_per_prospect into v_estimate_id, v_credits
      from public.lm_estimates e
     where e.account_id = v_campaign.account_id and e.status = 'done'
       and e.country_code = v_campaign.country_code
       and e.targeting = v_campaign.targeting
       and e.filters = (v_campaign.filters - 'paused_reason')
     order by e.created_at desc
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
        v_estimate_id := public.lm_request_estimate(v_campaign.account_id, v_campaign.country_code,
                                                    v_campaign.targeting, v_campaign.filters - 'paused_reason');
      end if;

      update public.lm_campaigns
         set credits_per_prospect = 1, estimate_id = v_estimate_id, price_pending = true
       where id = p_campaign_id;
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


