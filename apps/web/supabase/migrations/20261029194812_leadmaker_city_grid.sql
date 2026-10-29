alter table "public"."lm_campaign_zones" add column "latitude" double precision;

alter table "public"."lm_campaign_zones" add column "longitude" double precision;

alter table "public"."lm_campaign_zones" add column "zoom" smallint;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_city_grid(p_lat double precision, p_lng double precision, p_population integer)
 RETURNS TABLE(latitude double precision, longitude double precision)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with r as (
    select least(12.0, greatest(2.0, sqrt(p_population) / 150.0)) as km, 2.5 as step
  ), n as (
    select ceil(r.km / r.step)::integer as k, r.km, r.step from r
  )
  select p_lat + i * n.step / 111.0,
         p_lng + j * n.step / (111.0 * cos(radians(p_lat)))
    from n, generate_series(-n.k, n.k) i, generate_series(-n.k, n.k) j
   where sqrt(power(i * n.step, 2) + power(j * n.step, 2)) <= n.km + n.step / 2
   order by abs(i) + abs(j), i, j;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_target_zones(p_country_code text, p_targeting jsonb)
 RETURNS TABLE(geoname_id integer, label text, population integer, latitude double precision, longitude double precision, zoom smallint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select t.geoname_id, t.label, t.population, null::double precision, null::double precision, null::smallint
    from public.lm_target_cities(p_country_code, p_targeting) t
   where t.population < 50000
  union all
  select t.geoname_id,
         t.label || ' · ' || row_number() over (partition by t.geoname_id order by g.ord),
         t.population, g.latitude, g.longitude, 15::smallint
    from public.lm_target_cities(p_country_code, p_targeting) t
    join public.lm_geo_cities c on c.geoname_id = t.geoname_id
    cross join lateral (
      select gg.latitude, gg.longitude, row_number() over () as ord
        from public.lm_city_grid(c.latitude, c.longitude, t.population) gg
    ) g
   where t.population >= 50000;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_estimate_campaign(p_country_code text, p_targeting jsonb, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(cities integer, categories integer, searches bigint, expected_prospects bigint, rate numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_cities integer;
  v_zones bigint;
  v_listings numeric;
  v_categories integer;
  v_share numeric;
  v_reviews integer := coalesce((p_filters ->> 'min_reviews')::integer, 0);
begin
  -- Fiches Google d'une activité dans une ville : environ 1 pour 1 000 habitants (au moins 5),
  -- dans la limite de 120 par secteur de recherche.
  select count(*)::integer, coalesce(sum(z.zones), 0), coalesce(sum(least(z.zones * 120, greatest(5, z.population / 1000.0))), 0)
    into v_cities, v_zones, v_listings
    from (select tz.geoname_id, max(tz.population) as population, count(*) as zones
            from public.lm_target_zones(p_country_code, p_targeting) tz
           group by tz.geoname_id) z;

  select count(*)::integer into v_categories from public.lm_target_categories(p_targeting);

  v_share := 0.7 * 0.9
    * public.lm_rating_share(coalesce((p_filters ->> 'rating_min')::numeric, 0), coalesce((p_filters ->> 'rating_max')::numeric, 5))
    * case coalesce(p_filters ->> 'website', 'all') when 'with' then 0.75 when 'without' then 0.25 else 1 end
    * case when v_reviews >= 50 then 0.5 when v_reviews >= 10 then 0.8 else 1 end;

  return query
    select v_cities, v_categories, v_zones * v_categories,
           round(v_listings * v_categories * v_share)::bigint,
           round(case when v_cities > 0 then v_listings / v_cities * v_share else 0 end, 2);
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
  v_mean numeric;
  v_pick record;
  v_zone public.lm_campaign_zones%rowtype;
  v_created integer := 0;
  v_slots integer;
  v_zone_count integer;
  v_inserted integer;
begin
  -- un seul planificateur à la fois
  if not pg_try_advisory_xact_lock(hashtext('lm_schedule_discovery')) then
    return 0;
  end if;

  select * into v_settings from public.lm_discovery_settings where id;

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

    select coalesce(sum(kept)::numeric / nullif(sum(searches), 0), v_settings.default_rate) into v_mean
      from public.lm_campaign_categories where campaign_id = v_campaign.id;

    while v_slots > 0 loop
      select cc.gcid, cc.next_zone_idx, cat.label_en into v_pick
        from public.lm_campaign_categories cc
        join public.lm_categories cat using (gcid)
       where cc.campaign_id = v_campaign.id
         and not cc.abandoned
         and cc.next_zone_idx < v_zone_count
       order by (cc.searches + cc.in_flight > 0),
                cc.is_generic desc,
                (cc.kept + v_settings.prior * v_mean) / (cc.searches + v_settings.prior) desc,
                random()
       limit 1
       for update of cc skip locked;

      exit when v_pick.gcid is null;

      select * into v_zone from public.lm_campaign_zones
       where campaign_id = v_campaign.id and idx = v_pick.next_zone_idx;

      insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
      values (v_campaign.account_id, 'discovery',
              jsonb_build_object('campaign_id', v_campaign.id, 'gcid', v_pick.gcid, 'zone_idx', v_zone.idx,
                                 'category', v_pick.label_en, 'zone', v_zone.label,
                                 'country_code', v_campaign.country_code,
                                 'latitude', v_zone.latitude, 'longitude', v_zone.longitude, 'zoom', v_zone.zoom,
                                 'query', case when v_zone.latitude is null
                                               then v_pick.label_en || ' in ' || v_zone.label
                                               else v_pick.label_en end),
              'discovery:' || v_campaign.id || ':' || v_pick.gcid || ':' || v_zone.idx)
      on conflict (idempotency_key) do nothing;

      get diagnostics v_inserted = row_count;

      update public.lm_campaign_categories
         set next_zone_idx = next_zone_idx + 1, in_flight = in_flight + v_inserted
       where campaign_id = v_campaign.id and gcid = v_pick.gcid;

      v_created := v_created + v_inserted;
      v_slots := v_slots - v_inserted;
      v_pick := null;
    end loop;

    -- Plus rien à chercher et plus rien en cours : campagne terminée
    if not exists (
      select 1 from public.lm_campaign_categories cc
       where cc.campaign_id = v_campaign.id and (cc.in_flight > 0 or (not cc.abandoned and cc.next_zone_idx < v_zone_count))
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

  -- Premier lancement : on fige les villes et les catégories
  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
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

  update public.lm_campaigns
     set status = 'running', filters = filters - 'paused_reason'
   where id = p_campaign_id;
end;
$function$
;



-- migra n'écrit pas les droits d'exécution des fonctions
grant execute on function public.lm_city_grid(double precision, double precision, integer) to authenticated, service_role;
grant execute on function public.lm_target_zones(text, jsonb) to authenticated, service_role;
