alter table "public"."lm_prospects" add column "city" text;

alter table "public"."lm_prospects" add column "excluded_at" timestamp with time zone;

CREATE INDEX ix_lm_prospects_space_id_category ON public.lm_prospects USING btree (space_id, category);

CREATE INDEX ix_lm_prospects_space_id_city ON public.lm_prospects USING btree (space_id, city);

CREATE INDEX ix_lm_prospects_space_id_name ON public.lm_prospects USING btree (space_id, name);

CREATE INDEX ix_lm_prospects_space_id_rating ON public.lm_prospects USING btree (space_id, rating);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_delete_prospects(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with del as (
    delete from public.lm_prospects p
     where p.id = any (p_ids)
       and public.has_permission((select auth.uid()), p.account_id, 'settings.manage'::public.app_permissions)
    returning 1
  )
  select count(*) into v_count from del;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_exclude_prospects(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with target as (
    select p.id, p.account_id, p.space_id, p.site_key
      from public.lm_prospects p
     where p.id = any (p_ids) and p.excluded_at is null and public.has_role_on_account(p.account_id)
  ), upd as (
    update public.lm_prospects p set excluded_at = now()
      from target t where p.id = t.id
    returning t.account_id, t.space_id, t.site_key
  ), sup as (
    insert into public.lm_suppressions (account_id, space_id, site_key, reason)
    select distinct u.account_id, u.space_id, u.site_key, 'excluded'
      from upd u where u.site_key not like 'maps:%' and u.site_key not like 'tel:%'
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_prospect_facets(p_space_id uuid)
 RETURNS TABLE(kind text, value text, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select 'category', p.category, count(*) from public.lm_prospects p
   where p.space_id = p_space_id and p.category is not null group by p.category
  union all
  select 'city', p.city, count(*) from public.lm_prospects p
   where p.space_id = p_space_id and p.city is not null group by p.city
  union all
  select 'campaign', c.id::text, count(*) from public.lm_prospects p
    join public.lm_campaigns c on c.id = p.campaign_id
   where p.space_id = p_space_id group by c.id
  order by 1, 3 desc, 2;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_restore_prospects(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with target as (
    select p.id, p.space_id, p.site_key
      from public.lm_prospects p
     where p.id = any (p_ids) and p.excluded_at is not null and public.has_role_on_account(p.account_id)
  ), upd as (
    update public.lm_prospects p set excluded_at = null
      from target t where p.id = t.id
    returning t.space_id, t.site_key
  ), del as (
    delete from public.lm_suppressions s
     using upd u
     where s.space_id = u.space_id and s.site_key = u.site_key and s.reason = 'excluded'
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_import_prospects(p_space_id uuid, p_rows jsonb)
 RETURNS TABLE(inserted integer, duplicates integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_country text;
  v_total integer;
  v_inserted integer;
begin
  select account_id, country_code into v_account_id, v_country from public.lm_spaces where id = p_space_id;

  if v_account_id is null or not public.has_role_on_account(v_account_id) then
    raise exception 'space not found' using errcode = 'P0002';
  end if;

  v_total := jsonb_array_length(p_rows);

  if v_total > 20000 then
    raise exception 'too many rows' using errcode = 'P0001', hint = 'too_many_rows';
  end if;

  with src as (
    select distinct on (r ->> 'site_key') r
      from jsonb_array_elements(p_rows) r
     where length(trim(coalesce(r ->> 'site_key', ''))) > 0 and length(trim(coalesce(r ->> 'name', ''))) > 0
  ), ins as (
    insert into public.lm_prospects (account_id, space_id, name, category, phone, website, site_key, found_email,
                                     address, country_code, maps_url, source, city)
    select v_account_id, p_space_id, left(r ->> 'name', 500), left(r ->> 'category', 255), left(r ->> 'phone', 50),
           left(r ->> 'website', 1000), lower(r ->> 'site_key'), left(r ->> 'email', 320), r ->> 'address',
           coalesce(nullif(upper(r ->> 'country_code'), ''), v_country), left(r ->> 'maps_url', 1000), 'csv',
           left(nullif(trim(r ->> 'city'), ''), 200)
      from src
    on conflict (space_id, site_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return query select v_inserted, v_total - v_inserted;
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

  if not public.lm_debit_credits(v_campaign.account_id, 'discovery', 1, 'prospect:' || v_id,
                                 'discovery', p_campaign_id) then
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

CREATE OR REPLACE FUNCTION public.lm_site_known(p_space_id uuid, p_site_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.lm_prospects where space_id = p_space_id and site_key = p_site_key)
      or exists (select 1 from public.lm_suppressions s
                  where s.site_key = p_site_key
                    and (s.account_id is null
                         or (s.account_id = (select account_id from public.lm_spaces where id = p_space_id)
                             and (s.space_id is null or s.space_id = p_space_id))))
      or (select count(*) from public.lm_place_sightings where space_id = p_space_id and site_key = p_site_key)
         >= (select chain_min from public.lm_discovery_settings where id);
$function$
;



-- migra n'écrit pas les droits d'exécution des fonctions
grant execute on function public.lm_prospect_facets(uuid) to authenticated, service_role;
grant execute on function public.lm_exclude_prospects(uuid[]) to authenticated, service_role;
grant execute on function public.lm_restore_prospects(uuid[]) to authenticated, service_role;
grant execute on function public.lm_delete_prospects(uuid[]) to authenticated, service_role;
