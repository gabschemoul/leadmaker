-- Roadmap n°13 (validé par Gabriel le 2/11/2026) : crédits selon la difficulté + classement par prospects par Mo.
-- - lm_estimates.rate / credits_per_prospect : part des fiches lues qui passent les filtres et crédits par
--   prospect qui en découlent (paliers lm_discovery_settings.credit_tiers : >= 10 % → 1, 3-10 % → 2,
--   1-3 % → 3, < 1 % → 4), calculés quand l'estimation se termine (lm_record_estimate_search).
-- - lm_campaigns.credits_per_prospect / estimate_id : tarif figé au PREMIER lancement d'après l'estimation
--   faite avec exactement le même ciblage et les mêmes filtres ; sans estimation, lm_start_campaign refuse
--   (hint estimate_required) et l'application en lance une (lm_request_campaign_estimate).
--   lm_record_prospect débite ce tarif. Les campagnes déjà lancées gardent 1 crédit par prospect.
-- - lm_campaign_categories.proxy_bytes / lm_searches.proxy_bytes : trafic réel ajouté par le robot
--   (lm_add_search_bytes) ; lm_schedule_discovery classe les activités par prospects par Mo attendu
--   (default_search_mb = 4 Mo quand aucune mesure).
-- - lm_campaign_pricing : tarif lisible par les membres (figé ou celui de la dernière estimation).
alter table "public"."lm_campaign_categories" add column "proxy_bytes" bigint not null default 0;

alter table "public"."lm_campaigns" add column "credits_per_prospect" integer not null default 1;

alter table "public"."lm_campaigns" add column "estimate_id" uuid;

alter table "public"."lm_discovery_settings" add column "credit_tiers" jsonb not null default '[{"credits": 1, "min_rate": 0.10}, {"credits": 2, "min_rate": 0.03}, {"credits": 3, "min_rate": 0.01}, {"credits": 4, "min_rate": 0}]'::jsonb;

alter table "public"."lm_discovery_settings" add column "default_search_mb" numeric(6,2) not null default 4;

alter table "public"."lm_estimates" add column "credits_per_prospect" integer;

alter table "public"."lm_estimates" add column "rate" numeric(6,4);

alter table "public"."lm_searches" add column "proxy_bytes" bigint not null default 0;

alter table "public"."lm_campaigns" add constraint "lm_campaigns_credits_per_prospect" CHECK (((credits_per_prospect >= 1) AND (credits_per_prospect <= 10))) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_credits_per_prospect";

alter table "public"."lm_discovery_settings" add constraint "lm_discovery_settings_search_mb" CHECK ((default_search_mb > (0)::numeric)) not valid;

alter table "public"."lm_discovery_settings" validate constraint "lm_discovery_settings_search_mb";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_add_search_bytes(p_task_id bigint, p_bytes bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_task public.lm_tasks%rowtype;
begin
  if p_bytes is null or p_bytes <= 0 then
    return;
  end if;

  select * into v_task from public.lm_tasks where id = p_task_id and kind = 'discovery';

  if v_task.id is null then
    return;
  end if;

  update public.lm_campaign_categories
     set proxy_bytes = proxy_bytes + p_bytes
   where campaign_id = (v_task.payload ->> 'campaign_id')::uuid and gcid = v_task.payload ->> 'gcid';

  update public.lm_searches s
     set proxy_bytes = s.proxy_bytes + p_bytes
   where s.id = (select s2.id from public.lm_searches s2
                  where s2.campaign_id = (v_task.payload ->> 'campaign_id')::uuid
                    and s2.category = v_task.payload ->> 'gcid'
                    and s2.zone_key = v_task.payload ->> 'zone'
                  order by s2.wave desc limit 1);
end;
$function$
;

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
    select e.* from public.lm_estimates e, c
     where e.account_id = c.account_id and e.country_code = c.country_code
       and e.targeting = c.targeting and e.filters = (c.filters - 'paused_reason')
     order by (e.status = 'done') desc, e.created_at desc
     limit 1
  )
  select c.launched,
         case when c.launched then c.credits_per_prospect
              when e.status = 'done' then e.credits_per_prospect end,
         case when c.launched then (select e2.rate from public.lm_estimates e2 where e2.id = c.estimate_id)
              when e.status = 'done' then e.rate end,
         case when c.launched then c.estimate_id else e.id end,
         case when c.launched then null else e.status end,
         case when c.launched then null else e.done_searches end,
         case when c.launched then null else e.sample_searches end
    from c left join e on true;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_credits_for_rate(p_rate numeric)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    (select (t ->> 'credits')::integer
       from public.lm_discovery_settings s, jsonb_array_elements(s.credit_tiers) t
      where s.id and p_rate is not null and p_rate >= (t ->> 'min_rate')::numeric
      order by (t ->> 'min_rate')::numeric desc
      limit 1),
    1);
$function$
;

CREATE OR REPLACE FUNCTION public.lm_request_campaign_estimate(p_campaign_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  if v_campaign.id is null or not public.has_role_on_account(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  return public.lm_request_estimate(v_campaign.account_id, v_campaign.country_code, v_campaign.targeting,
                                    v_campaign.filters - 'paused_reason');
end;
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
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_record_prospect(p_campaign_id uuid, p_place jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_id uuid;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  insert into public.lm_prospects (account_id, space_id, google_place_id, name, category, rating, review_count,
                                   address, country_code, phone, website, site_key, maps_url, source, campaign_id, city)
  values (v_campaign.account_id, v_campaign.space_id, p_place ->> 'place_id', left(p_place ->> 'name', 500),
          left(p_place ->> 'category', 255), (p_place ->> 'rating')::numeric(2,1), (p_place ->> 'review_count')::integer,
          p_place ->> 'address', v_campaign.country_code, left(p_place ->> 'phone', 50), left(p_place ->> 'website', 1000),
          p_place ->> 'site_key', left(p_place ->> 'maps_url', 1000), 'maps', p_campaign_id, left(p_place ->> 'city', 200))
  on conflict (space_id, site_key) do nothing
  returning id into v_id;

  if v_id is null then
    return 'duplicate';
  end if;

  if not public.lm_debit_credits(v_campaign.account_id, 'discovery', greatest(v_campaign.credits_per_prospect, 1),
                                 'prospect:' || v_id, 'discovery', p_campaign_id) then
    delete from public.lm_prospects where id = v_id;
    perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
    return 'no_credits';
  end if;

  update public.lm_place_sightings set kept = true
   where space_id = v_campaign.space_id and google_place_id = p_place ->> 'place_id';

  return 'kept';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_schedule_discovery()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings public.lm_discovery_settings%rowtype;
  v_campaign record;
  v_pick record;
  v_zone public.lm_campaign_zones%rowtype;
  v_created integer := 0;
  v_slots integer;
  v_explore_slots integer;
  v_exploring integer;
  v_explore boolean;
  v_zone_count integer;
  v_inserted integer;
begin
  -- un seul planificateur à la fois
  if not pg_try_advisory_xact_lock(hashtext('lm_schedule_discovery')) then
    return 0;
  end if;

  select * into v_settings from public.lm_discovery_settings where id;

  -- Places d'exploration : la part réglée, arrondie, au moins une
  v_explore_slots := greatest(1, round(v_settings.explore_share * v_settings.tasks_per_campaign));

  for v_campaign in
    select c.id, c.account_id, c.country_code
      from public.lm_campaigns c
     where c.status = 'running'
  loop
    select v_settings.tasks_per_campaign - count(*) into v_slots
      from public.lm_tasks t
     where t.kind = 'discovery' and t.status in ('queued', 'running')
       and t.payload ->> 'campaign_id' = v_campaign.id::text;

    select count(*) into v_zone_count from public.lm_campaign_zones where campaign_id = v_campaign.id;

    -- Recherches en cours sur des activités dont on n'a encore aucun résultat
    select coalesce(sum(in_flight), 0) into v_exploring
      from public.lm_campaign_categories where campaign_id = v_campaign.id and searches = 0;

    while v_slots > 0 loop
      v_explore := v_exploring < v_explore_slots;

      select cc.gcid, cc.next_zone_idx, cat.label_en, (cc.searches + cc.in_flight = 0) as untried into v_pick
        from public.lm_campaign_categories cc
        join public.lm_categories cat using (gcid)
       where cc.campaign_id = v_campaign.id
         and not cc.abandoned and not cc.removed
         and cc.next_zone_idx < v_zone_count
       order by case
                  when cc.searches + cc.in_flight = 0 then (case when v_explore then 0 else 1 end)
                  when cc.kept > 0 then (case when v_explore then 1 else 0 end)
                  else 2
                end,
                (cc.searches + cc.in_flight = 0 and cc.is_generic) desc,
                -- prospects par Mo de proxy attendu : trafic mesuré de l'activité (sa moyenne par recherche
                -- s'applique aussi aux recherches en cours et au lissage), sinon le trafic par défaut
                cc.kept::numeric / case
                  when cc.proxy_bytes > 0 and cc.searches > 0
                    then cc.proxy_bytes / 1e6 * (cc.searches + cc.in_flight + v_settings.prior) / cc.searches
                  else v_settings.default_search_mb * (cc.searches + cc.in_flight + v_settings.prior)
                end desc,
                random()
       limit 1
       for update of cc skip locked;

      exit when v_pick.gcid is null;

      select * into v_zone from public.lm_campaign_zones
       where campaign_id = v_campaign.id and idx = v_pick.next_zone_idx;

      -- Ville retirée après le lancement : on passe à la suivante sans rien planifier
      if v_zone.removed then
        update public.lm_campaign_categories set next_zone_idx = next_zone_idx + 1
         where campaign_id = v_campaign.id and gcid = v_pick.gcid;
        v_pick := null;
        continue;
      end if;

      insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
      values (v_campaign.account_id, 'discovery',
              jsonb_build_object('campaign_id', v_campaign.id, 'gcid', v_pick.gcid, 'zone_idx', v_zone.idx,
                                 'category', v_pick.label_en, 'zone', v_zone.label,
                                 'country_code', v_campaign.country_code,
                                 'latitude', v_zone.latitude, 'longitude', v_zone.longitude, 'zoom', v_zone.zoom,
                                 'geoname_id', v_zone.geoname_id,
                                 'city', (select c.name from public.lm_geo_cities c where c.geoname_id = v_zone.geoname_id),
                                 'query', case when v_zone.latitude is null
                                               then v_pick.label_en || ' in ' || v_zone.label
                                               else v_pick.label_en end),
              'discovery:' || v_campaign.id || ':' || v_pick.gcid || ':' || v_zone.idx)
      on conflict (idempotency_key) do nothing;

      get diagnostics v_inserted = row_count;

      update public.lm_campaign_categories
         set next_zone_idx = next_zone_idx + 1, in_flight = in_flight + v_inserted
       where campaign_id = v_campaign.id and gcid = v_pick.gcid;

      if v_pick.untried then
        v_exploring := v_exploring + v_inserted;
      end if;

      v_created := v_created + v_inserted;
      v_slots := v_slots - v_inserted;
      v_pick := null;
    end loop;

    -- Plus rien à chercher et plus rien en cours : campagne terminée
    if not exists (
      select 1 from public.lm_campaign_categories cc
       where cc.campaign_id = v_campaign.id
         and (cc.in_flight > 0 or (not cc.abandoned and not cc.removed and cc.next_zone_idx < v_zone_count))
    ) then
      update public.lm_campaigns set status = 'completed' where id = v_campaign.id;
    end if;
  end loop;

  return v_created;
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
    -- Sans estimation, la campagne ne part pas : l'application en lance une (lm_request_campaign_estimate).
    select e.id, e.credits_per_prospect into v_estimate_id, v_credits
      from public.lm_estimates e
     where e.account_id = v_campaign.account_id and e.status = 'done'
       and e.country_code = v_campaign.country_code
       and e.targeting = v_campaign.targeting
       and e.filters = (v_campaign.filters - 'paused_reason')
     order by e.created_at desc
     limit 1;

    if v_estimate_id is null then
      raise exception 'estimate required before launch' using errcode = 'P0001', hint = 'estimate_required';
    end if;

    update public.lm_campaigns
       set credits_per_prospect = coalesce(v_credits, 1), estimate_id = v_estimate_id
     where id = p_campaign_id;

    insert into public.lm_campaign_zones (campaign_id, idx, account_id, geoname_id, label, population,
                                          latitude, longitude, zoom)
      select p_campaign_id, (row_number() over (order by t.population desc, t.geoname_id, t.label)) - 1,
             v_campaign.account_id, t.geoname_id, t.label, t.population, t.latitude, t.longitude, t.zoom
        from public.lm_target_zones(v_campaign.country_code, v_campaign.targeting) t;

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

-- Droits (non écrits par l'outil de diff)
revoke all on function public.lm_add_search_bytes(bigint, bigint) from public;
grant execute on function public.lm_add_search_bytes(bigint, bigint) to service_role;

grant execute on function public.lm_credits_for_rate(numeric) to authenticated, service_role;

grant execute on function public.lm_campaign_pricing(uuid) to authenticated, service_role;

revoke all on function public.lm_request_campaign_estimate(uuid) from public;
grant execute on function public.lm_request_campaign_estimate(uuid) to authenticated, service_role;
