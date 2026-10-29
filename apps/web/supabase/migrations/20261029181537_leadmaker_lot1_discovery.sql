
  create table "public"."lm_campaign_categories" (
    "campaign_id" uuid not null,
    "gcid" text not null,
    "account_id" uuid not null,
    "is_generic" boolean not null default false,
    "next_zone_idx" integer not null default 0,
    "in_flight" integer not null default 0,
    "searches" integer not null default 0,
    "cards" integer not null default 0,
    "cards_new" integer not null default 0,
    "kept" integer not null default 0,
    "abandoned" boolean not null default false
      );


alter table "public"."lm_campaign_categories" enable row level security;


  create table "public"."lm_campaign_zones" (
    "campaign_id" uuid not null,
    "idx" integer not null,
    "account_id" uuid not null,
    "geoname_id" integer not null,
    "label" text not null,
    "population" integer not null default 0
      );


alter table "public"."lm_campaign_zones" enable row level security;


  create table "public"."lm_categories" (
    "gcid" text not null,
    "label_en" text not null,
    "label_fr" text not null,
    "family" text not null,
    "is_generic" boolean not null default false,
    "is_excluded" boolean not null default false
      );


alter table "public"."lm_categories" enable row level security;


  create table "public"."lm_discovery_settings" (
    "id" boolean not null default true,
    "prior" integer not null default 5,
    "min_searches" integer not null default 40,
    "min_rate" numeric(5,4) not null default 0.05,
    "chain_min" integer not null default 5,
    "max_results" integer not null default 120,
    "tasks_per_campaign" integer not null default 2,
    "default_rate" numeric(6,4) not null default 0.3,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_discovery_settings" enable row level security;


  create table "public"."lm_place_sightings" (
    "space_id" uuid not null,
    "google_place_id" text not null,
    "site_key" text,
    "kept" boolean not null default false,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_place_sightings" enable row level security;

CREATE INDEX ix_lm_campaign_categories_account_id ON public.lm_campaign_categories USING btree (account_id);

CREATE INDEX ix_lm_campaign_zones_account_id ON public.lm_campaign_zones USING btree (account_id);

CREATE INDEX ix_lm_categories_label_en ON public.lm_categories USING btree (label_en);

CREATE INDEX ix_lm_place_sightings_site_key ON public.lm_place_sightings USING btree (space_id, site_key);

CREATE INDEX ix_lm_tasks_discovery_campaign ON public.lm_tasks USING btree (((payload ->> 'campaign_id'::text)), status) WHERE (kind = 'discovery'::public.lm_task_kind);

CREATE UNIQUE INDEX lm_campaign_categories_pkey ON public.lm_campaign_categories USING btree (campaign_id, gcid);

CREATE UNIQUE INDEX lm_campaign_zones_pkey ON public.lm_campaign_zones USING btree (campaign_id, idx);

CREATE UNIQUE INDEX lm_categories_pkey ON public.lm_categories USING btree (gcid);

CREATE UNIQUE INDEX lm_discovery_settings_pkey ON public.lm_discovery_settings USING btree (id);

CREATE UNIQUE INDEX lm_place_sightings_pkey ON public.lm_place_sightings USING btree (space_id, google_place_id);

alter table "public"."lm_campaign_categories" add constraint "lm_campaign_categories_pkey" PRIMARY KEY using index "lm_campaign_categories_pkey";

alter table "public"."lm_campaign_zones" add constraint "lm_campaign_zones_pkey" PRIMARY KEY using index "lm_campaign_zones_pkey";

alter table "public"."lm_categories" add constraint "lm_categories_pkey" PRIMARY KEY using index "lm_categories_pkey";

alter table "public"."lm_discovery_settings" add constraint "lm_discovery_settings_pkey" PRIMARY KEY using index "lm_discovery_settings_pkey";

alter table "public"."lm_place_sightings" add constraint "lm_place_sightings_pkey" PRIMARY KEY using index "lm_place_sightings_pkey";

alter table "public"."lm_campaign_categories" add constraint "lm_campaign_categories_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_categories" validate constraint "lm_campaign_categories_account_id_fkey";

alter table "public"."lm_campaign_categories" add constraint "lm_campaign_categories_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_categories" validate constraint "lm_campaign_categories_campaign_id_fkey";

alter table "public"."lm_campaign_categories" add constraint "lm_campaign_categories_gcid_fkey" FOREIGN KEY (gcid) REFERENCES public.lm_categories(gcid) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_categories" validate constraint "lm_campaign_categories_gcid_fkey";

alter table "public"."lm_campaign_zones" add constraint "lm_campaign_zones_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_zones" validate constraint "lm_campaign_zones_account_id_fkey";

alter table "public"."lm_campaign_zones" add constraint "lm_campaign_zones_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_zones" validate constraint "lm_campaign_zones_campaign_id_fkey";

alter table "public"."lm_discovery_settings" add constraint "lm_discovery_settings_positive" CHECK (((prior >= 0) AND (min_searches > 0) AND (min_rate >= (0)::numeric) AND (chain_min > 1) AND (max_results > 0) AND (tasks_per_campaign > 0))) not valid;

alter table "public"."lm_discovery_settings" validate constraint "lm_discovery_settings_positive";

alter table "public"."lm_discovery_settings" add constraint "lm_discovery_settings_single_row" CHECK (id) not valid;

alter table "public"."lm_discovery_settings" validate constraint "lm_discovery_settings_single_row";

alter table "public"."lm_place_sightings" add constraint "lm_place_sightings_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.lm_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."lm_place_sightings" validate constraint "lm_place_sightings_space_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_progress(p_campaign_id uuid)
 RETURNS TABLE(zones integer, categories integer, searches_total bigint, searches_done bigint, in_flight bigint, abandoned integer, prospects bigint, cards bigint, last_search_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (select count(*)::integer from public.lm_campaign_zones z where z.campaign_id = p_campaign_id),
         count(cc.gcid)::integer,
         (select count(*) from public.lm_campaign_zones z where z.campaign_id = p_campaign_id) * count(cc.gcid),
         coalesce(sum(cc.searches), 0),
         coalesce(sum(cc.in_flight), 0),
         count(*) filter (where cc.abandoned)::integer,
         (select count(*) from public.lm_credit_ledger l where l.campaign_id = p_campaign_id and l.kind = 'discovery' and l.delta < 0),
         coalesce(sum(cc.cards), 0),
         (select max(s.created_at) from public.lm_searches s where s.campaign_id = p_campaign_id)
    from public.lm_campaign_categories cc
   where cc.campaign_id = p_campaign_id;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_city_label(p_name text, p_country_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_name || ', ' || p_country_name;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_estimate_campaign(p_country_code text, p_targeting jsonb)
 RETURNS TABLE(cities integer, categories integer, searches bigint, expected_prospects bigint, rate numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_rate numeric;
begin
  select sum(cc.kept)::numeric / nullif(sum(cc.searches), 0) into v_rate from public.lm_campaign_categories cc;

  if v_rate is null then
    select default_rate into v_rate from public.lm_discovery_settings where id;
  end if;

  v_rate := coalesce(v_rate, 0.3);

  return query
    with ci as (select count(*)::integer n from public.lm_target_cities(p_country_code, p_targeting)),
         ca as (select count(*)::integer n from public.lm_target_categories(p_targeting))
    select ci.n, ca.n, ci.n::bigint * ca.n, round(ci.n::bigint * ca.n * v_rate)::bigint, round(v_rate, 4)
      from ci, ca;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_search(p_campaign_id uuid, p_gcid text, p_zone_idx integer, p_cards integer, p_new integer, p_kept integer, p_duration_ms integer, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings public.lm_discovery_settings%rowtype;
  v_campaign public.lm_campaigns%rowtype;
  v_zone public.lm_campaign_zones%rowtype;
begin
  select * into v_settings from public.lm_discovery_settings where id;
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;
  select * into v_zone from public.lm_campaign_zones where campaign_id = p_campaign_id and idx = p_zone_idx;

  insert into public.lm_searches (account_id, campaign_id, country_code, category, zone_key, cards_seen, cards_new,
                                  cards_kept, duration_ms, error)
  values (v_campaign.account_id, p_campaign_id, v_campaign.country_code, p_gcid, v_zone.label, p_cards, p_new,
          p_kept, p_duration_ms, p_error)
  on conflict (campaign_id, category, zone_key, wave) do update set
    cards_seen = excluded.cards_seen, cards_new = excluded.cards_new, cards_kept = excluded.cards_kept,
    duration_ms = excluded.duration_ms, error = excluded.error;

  update public.lm_campaign_categories cc
     set in_flight = greatest(cc.in_flight - 1, 0),
         searches = cc.searches + 1,
         cards = cc.cards + p_cards,
         cards_new = cc.cards_new + p_new,
         kept = cc.kept + p_kept,
         abandoned = cc.abandoned or (
           cc.searches + 1 >= v_settings.min_searches
           and (cc.kept + p_kept) < v_settings.min_rate * (cc.searches + 1)
         )
   where cc.campaign_id = p_campaign_id and cc.gcid = p_gcid;
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
                                     address, country_code, source)
    select v_account_id, p_space_id, left(r ->> 'name', 500), left(r ->> 'category', 255), left(r ->> 'phone', 50),
           left(r ->> 'website', 1000), lower(r ->> 'site_key'), left(r ->> 'email', 320), r ->> 'address',
           coalesce(nullif(upper(r ->> 'country_code'), ''), v_country), 'csv'
      from src
    on conflict (space_id, site_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return query select v_inserted, v_total - v_inserted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_mark_place_seen(p_space_id uuid, p_place_id text, p_site_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
  v_chain_min integer;
begin
  insert into public.lm_place_sightings (space_id, google_place_id, site_key)
  values (p_space_id, p_place_id, p_site_key)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  -- Un même site sur CHAIN_MIN fiches ou plus : chaîne, le prospect déjà gardé est marqué
  if v_inserted > 0 and p_site_key is not null then
    select chain_min into v_chain_min from public.lm_discovery_settings where id;

    if (select count(*) from public.lm_place_sightings where space_id = p_space_id and site_key = p_site_key) >= v_chain_min then
      update public.lm_prospects set is_chain = true
       where space_id = p_space_id and site_key = p_site_key and not is_chain;
    end if;
  end if;

  return v_inserted > 0;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_pause_campaign(p_campaign_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from public.lm_campaigns where id = p_campaign_id;

  if v_account_id is null
     or (auth.role() = 'authenticated' and not public.has_role_on_account(v_account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  update public.lm_campaigns
     set status = 'paused',
         filters = case when p_reason is null then filters else filters || jsonb_build_object('paused_reason', p_reason) end
   where id = p_campaign_id and status = 'running';

  update public.lm_tasks set status = 'cancelled', finished_at = now()
   where kind = 'discovery' and status = 'queued' and payload ->> 'campaign_id' = p_campaign_id::text;
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
                                   address, country_code, phone, website, site_key, maps_url, source)
  values (v_campaign.account_id, v_campaign.space_id, p_place ->> 'place_id', left(p_place ->> 'name', 500),
          left(p_place ->> 'category', 255), (p_place ->> 'rating')::numeric(2,1), (p_place ->> 'review_count')::integer,
          p_place ->> 'address', v_campaign.country_code, left(p_place ->> 'phone', 50), left(p_place ->> 'website', 1000),
          p_place ->> 'site_key', left(p_place ->> 'maps_url', 1000), 'maps')
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

CREATE OR REPLACE FUNCTION public.lm_release_search(p_campaign_id uuid, p_gcid text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.lm_campaign_categories set in_flight = greatest(in_flight - 1, 0)
   where campaign_id = p_campaign_id and gcid = p_gcid;
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
                                 'query', v_pick.label_en || ' in ' || v_zone.label),
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
      or (select count(*) from public.lm_place_sightings where space_id = p_space_id and site_key = p_site_key)
         >= (select chain_min from public.lm_discovery_settings where id);
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
    insert into public.lm_campaign_zones (campaign_id, idx, account_id, geoname_id, label, population)
      select p_campaign_id, (row_number() over (order by t.population desc, t.geoname_id)) - 1,
             v_campaign.account_id, t.geoname_id, t.label, t.population
        from public.lm_target_cities(v_campaign.country_code, v_campaign.targeting) t;

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

CREATE OR REPLACE FUNCTION public.lm_target_categories(p_targeting jsonb)
 RETURNS TABLE(gcid text, is_generic boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select c.gcid, c.is_generic
    from public.lm_categories c
   where not c.is_excluded
     and case coalesce(p_targeting -> 'categories' ->> 'mode', 'generic')
           when 'all' then true
           when 'list' then c.gcid in (select jsonb_array_elements_text(p_targeting -> 'categories' -> 'gcids'))
           else c.is_generic
         end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_target_cities(p_country_code text, p_targeting jsonb)
 RETURNS TABLE(geoname_id integer, label text, population integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_cities jsonb := coalesce(p_targeting -> 'cities', '{"mode":"country"}'::jsonb);
  v_mode text := coalesce(v_cities ->> 'mode', 'country');
  v_min integer := coalesce((v_cities ->> 'min_population')::integer, 0);
  v_max integer := (v_cities ->> 'max_population')::integer;
  v_limit integer := least(coalesce((p_targeting ->> 'max_cities')::integer, 5000), 20000);
  v_country_name text;
  v_lat double precision;
  v_lng double precision;
  v_radius double precision;
begin
  select name into v_country_name from public.lm_country_coverage where country_code = upper(p_country_code);
  v_country_name := coalesce(v_country_name, upper(p_country_code));

  if v_mode = 'list' then
    return query
      select c.geoname_id, public.lm_city_label(c.name, v_country_name), c.population
        from public.lm_geo_cities c
       where c.geoname_id in (select (jsonb_array_elements_text(v_cities -> 'geoname_ids'))::integer)
         and c.country_code = upper(p_country_code)
       order by c.population desc
       limit v_limit;
  elsif v_mode = 'radius' then
    select c.latitude, c.longitude into v_lat, v_lng
      from public.lm_geo_cities c where c.geoname_id = (v_cities ->> 'geoname_id')::integer;
    v_radius := coalesce((v_cities ->> 'radius_km')::double precision, 30);

    return query
      select c.geoname_id, public.lm_city_label(c.name, v_country_name), c.population
        from public.lm_geo_cities c
       where c.country_code = upper(p_country_code)
         and c.population >= v_min
         and c.latitude between v_lat - v_radius / 111.0 and v_lat + v_radius / 111.0
         and 6371 * 2 * asin(sqrt(
               power(sin(radians(c.latitude - v_lat) / 2), 2)
               + cos(radians(v_lat)) * cos(radians(c.latitude)) * power(sin(radians(c.longitude - v_lng) / 2), 2)
             )) <= v_radius
       order by c.population desc
       limit v_limit;
  else
    return query
      select c.geoname_id, public.lm_city_label(c.name, v_country_name), c.population
        from public.lm_geo_cities c
       where c.country_code = upper(p_country_code)
         and c.population >= v_min
         and (v_max is null or c.population < v_max)
       order by c.population desc
       limit v_limit;
  end if;
end;
$function$
;

-- Retire les droits par défaut de Supabase (truncate contourne la RLS) avant les droits utiles
revoke all on public.lm_categories from anon, authenticated, service_role;
revoke all on public.lm_discovery_settings from anon, authenticated, service_role;
revoke all on public.lm_campaign_zones from anon, authenticated, service_role;
revoke all on public.lm_campaign_categories from anon, authenticated, service_role;
revoke all on public.lm_place_sightings from anon, authenticated, service_role;

grant select on table "public"."lm_campaign_categories" to "authenticated";

grant delete on table "public"."lm_campaign_categories" to "service_role";

grant insert on table "public"."lm_campaign_categories" to "service_role";

grant select on table "public"."lm_campaign_categories" to "service_role";

grant update on table "public"."lm_campaign_categories" to "service_role";

grant select on table "public"."lm_campaign_zones" to "authenticated";

grant delete on table "public"."lm_campaign_zones" to "service_role";

grant insert on table "public"."lm_campaign_zones" to "service_role";

grant select on table "public"."lm_campaign_zones" to "service_role";

grant update on table "public"."lm_campaign_zones" to "service_role";

grant select on table "public"."lm_categories" to "authenticated";

grant delete on table "public"."lm_categories" to "service_role";

grant insert on table "public"."lm_categories" to "service_role";

grant select on table "public"."lm_categories" to "service_role";

grant update on table "public"."lm_categories" to "service_role";

grant select on table "public"."lm_discovery_settings" to "authenticated";

grant delete on table "public"."lm_discovery_settings" to "service_role";

grant insert on table "public"."lm_discovery_settings" to "service_role";

grant select on table "public"."lm_discovery_settings" to "service_role";

grant update on table "public"."lm_discovery_settings" to "service_role";

grant delete on table "public"."lm_place_sightings" to "service_role";

grant insert on table "public"."lm_place_sightings" to "service_role";

grant select on table "public"."lm_place_sightings" to "service_role";

grant update on table "public"."lm_place_sightings" to "service_role";


  create policy "lm_campaign_categories_read"
  on "public"."lm_campaign_categories"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_campaign_categories"
  on "public"."lm_campaign_categories"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_campaign_zones_read"
  on "public"."lm_campaign_zones"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_campaign_zones"
  on "public"."lm_campaign_zones"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());



  create policy "lm_categories_read"
  on "public"."lm_categories"
  as permissive
  for select
  to authenticated
using (true);



  create policy "lm_discovery_settings_read"
  on "public"."lm_discovery_settings"
  as permissive
  for select
  to authenticated
using (true);


CREATE TRIGGER lm_discovery_settings_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_discovery_settings FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- ---------------------------------------------------------------- lien prospect → campagne
alter table "public"."lm_prospects" add column "campaign_id" uuid;

CREATE INDEX ix_lm_prospects_campaign_id_created_at ON public.lm_prospects USING btree (campaign_id, created_at DESC);

alter table "public"."lm_prospects" add constraint "lm_prospects_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE SET NULL not valid;

alter table "public"."lm_prospects" validate constraint "lm_prospects_campaign_id_fkey";

set check_function_bodies = off;

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
                                   address, country_code, phone, website, site_key, maps_url, source, campaign_id)
  values (v_campaign.account_id, v_campaign.space_id, p_place ->> 'place_id', left(p_place ->> 'name', 500),
          left(p_place ->> 'category', 255), (p_place ->> 'rating')::numeric(2,1), (p_place ->> 'review_count')::integer,
          p_place ->> 'address', v_campaign.country_code, left(p_place ->> 'phone', 50), left(p_place ->> 'website', 1000),
          p_place ->> 'site_key', left(p_place ->> 'maps_url', 1000), 'maps', p_campaign_id)
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



-- Statut des campagnes : uniquement via lm_start_campaign / lm_pause_campaign (quotas, préparation des zones)
revoke update on public.lm_campaigns from authenticated;
grant update (name, country_code, targeting, filters, templates, daily_limit, auto_validation)
  on table public.lm_campaigns to authenticated;

-- Réglages par défaut du moteur de découverte
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------- droits d'exécution des fonctions
-- migra n'écrit pas les GRANT EXECUTE : ils sont recopiés ici depuis les fichiers de schéma.
-- Sans eux, seul service_role (droits par défaut) peut appeler ces fonctions.
grant execute on function public.lm_seat_limit(uuid) to authenticated, service_role;
grant execute on function public.lm_space_limit(uuid) to authenticated, service_role;
grant execute on function public.lm_city_label(text, text) to authenticated, service_role;
grant execute on function public.lm_target_cities(text, jsonb) to authenticated, service_role;
grant execute on function public.lm_target_categories(jsonb) to authenticated, service_role;
grant execute on function public.lm_estimate_campaign(text, jsonb) to authenticated, service_role;
grant execute on function public.lm_start_campaign(uuid) to authenticated, service_role;
grant execute on function public.lm_pause_campaign(uuid, text) to authenticated, service_role;
grant execute on function public.lm_campaign_progress(uuid) to authenticated, service_role;
grant execute on function public.lm_import_prospects(uuid, jsonb) to authenticated, service_role;
