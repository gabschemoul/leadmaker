
  create table "public"."lm_place_searches" (
    "id" bigint generated always as identity not null,
    "country_code" character(2) not null,
    "gcid" text not null,
    "geoname_id" integer,
    "latitude" double precision,
    "longitude" double precision,
    "zoom" smallint,
    "zone_key" text not null,
    "query" text,
    "place_ids" text[] not null default '{}'::text[],
    "cards" integer not null default 0,
    "complete" boolean not null default false,
    "source" text not null default 'discovery'::text,
    "campaign_id" uuid,
    "searched_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_place_searches" enable row level security;


  create table "public"."lm_places" (
    "google_place_id" text not null,
    "name" character varying(500) not null,
    "category" character varying(255),
    "gcid" text,
    "address" text,
    "city" text,
    "geoname_id" integer,
    "country_code" character(2) not null,
    "latitude" double precision,
    "longitude" double precision,
    "phone" character varying(50),
    "website" character varying(1000),
    "site_key" text,
    "website_known" boolean not null default false,
    "rating" numeric(2,1),
    "review_count" integer,
    "maps_url" character varying(1000),
    "is_chain" boolean not null default false,
    "site_text" text,
    "site_status" text,
    "site_read_at" timestamp with time zone,
    "first_seen_at" timestamp with time zone not null default now(),
    "last_seen_at" timestamp with time zone not null default now(),
    "details_at" timestamp with time zone,
    "updated_at" timestamp with time zone not null default now(),
    "closed_at" timestamp with time zone
      );


alter table "public"."lm_places" enable row level security;

CREATE INDEX ix_lm_place_searches_campaign_id ON public.lm_place_searches USING btree (campaign_id);

CREATE INDEX ix_lm_place_searches_key ON public.lm_place_searches USING btree (country_code, gcid, zone_key, searched_at DESC);

CREATE INDEX ix_lm_places_country_code_city ON public.lm_places USING btree (country_code, city);

CREATE INDEX ix_lm_places_country_code_lat_lng ON public.lm_places USING btree (country_code, latitude, longitude);

CREATE INDEX ix_lm_places_gcid ON public.lm_places USING btree (gcid);

CREATE INDEX ix_lm_places_site_key ON public.lm_places USING btree (site_key);

CREATE UNIQUE INDEX lm_place_searches_pkey ON public.lm_place_searches USING btree (id);

CREATE UNIQUE INDEX lm_places_pkey ON public.lm_places USING btree (google_place_id);

alter table "public"."lm_place_searches" add constraint "lm_place_searches_pkey" PRIMARY KEY using index "lm_place_searches_pkey";

alter table "public"."lm_places" add constraint "lm_places_pkey" PRIMARY KEY using index "lm_places_pkey";

alter table "public"."lm_place_searches" add constraint "lm_place_searches_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE SET NULL not valid;

alter table "public"."lm_place_searches" validate constraint "lm_place_searches_campaign_id_fkey";

alter table "public"."lm_places" add constraint "lm_places_country_code_upper" CHECK (((country_code)::text = upper((country_code)::text))) not valid;

alter table "public"."lm_places" validate constraint "lm_places_country_code_upper";

alter table "public"."lm_places" add constraint "lm_places_site_status" CHECK (((site_status IS NULL) OR (site_status = ANY (ARRAY['ok'::text, 'unreachable'::text, 'social'::text])))) not valid;

alter table "public"."lm_places" validate constraint "lm_places_site_status";

alter table "public"."lm_places" add constraint "lm_places_website_http" CHECK (((website IS NULL) OR ((website)::text ~* '^https?://[^/\s]+'::text))) not valid;

alter table "public"."lm_places" validate constraint "lm_places_website_http";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_place_zone_key(p_geoname_id integer, p_latitude double precision, p_longitude double precision, p_zoom integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(p_geoname_id::text, '?')
         || case
              when p_latitude is null or p_longitude is null then ''
              else '@' || round(p_latitude::numeric, 4) || ',' || round(p_longitude::numeric, 4)
                   || ',' || coalesce(p_zoom, 15)
            end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_record_search_places(p_search jsonb, p_places jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_country text := upper(p_search ->> 'country_code');
  v_count integer;
  v_chain_min integer;
  v_keys text[];
begin
  if v_country is null or length(v_country) <> 2 or jsonb_typeof(p_places) is distinct from 'array' then
    return 0;
  end if;

  with src as (
    select distinct on (x.place_id)
           x.place_id, left(trim(x.name), 500) as name, left(nullif(trim(x.category), ''), 255) as category,
           case when x.rating between 0 and 5 then round(x.rating, 1)::numeric(2,1) end as rating,
           case when x.review_count >= 0 then x.review_count end as review_count,
           nullif(trim(x.address), '') as address, left(nullif(trim(x.phone), ''), 50) as phone,
           public.lm_clean_website(x.website) as website, nullif(trim(x.site_key), '') as site_key,
           coalesce(x.website_known, false) as website_known, left(nullif(trim(x.maps_url), ''), 1000) as maps_url,
           x.latitude, x.longitude, nullif(trim(x.city), '') as city, x.geoname_id, coalesce(x.opened, false) as opened
      from jsonb_to_recordset(p_places) as x(
             place_id text, name text, category text, rating numeric, review_count integer, address text,
             phone text, website text, website_known boolean, site_key text, maps_url text,
             latitude double precision, longitude double precision, city text, geoname_id integer, opened boolean)
     where nullif(trim(x.place_id), '') is not null and nullif(trim(x.name), '') is not null
     order by x.place_id, x.opened desc nulls last
  )
  insert into public.lm_places as p (google_place_id, name, category, gcid, address, city, geoname_id, country_code,
                                     latitude, longitude, phone, website, site_key, website_known, rating,
                                     review_count, maps_url, details_at)
  select s.place_id, s.name, s.category,
         (select c.gcid from public.lm_categories c where c.label_en = s.category order by c.gcid limit 1),
         s.address, s.city, s.geoname_id, v_country, s.latitude, s.longitude, s.phone, s.website,
         case when s.website is not null then s.site_key end, s.website_known or s.website is not null,
         s.rating, s.review_count, s.maps_url, case when s.opened then now() end
    from src s
  on conflict (google_place_id) do update set
    name = excluded.name,
    category = coalesce(excluded.category, p.category),
    gcid = coalesce(excluded.gcid, p.gcid),
    address = coalesce(excluded.address, p.address),
    city = coalesce(excluded.city, p.city),
    geoname_id = coalesce(excluded.geoname_id, p.geoname_id),
    country_code = excluded.country_code,
    latitude = coalesce(excluded.latitude, p.latitude),
    longitude = coalesce(excluded.longitude, p.longitude),
    phone = coalesce(excluded.phone, p.phone),
    website = case when excluded.website_known then excluded.website else p.website end,
    site_key = case when excluded.website_known then excluded.site_key else p.site_key end,
    website_known = p.website_known or excluded.website_known,
    rating = coalesce(excluded.rating, p.rating),
    review_count = coalesce(excluded.review_count, p.review_count),
    maps_url = coalesce(excluded.maps_url, p.maps_url),
    details_at = coalesce(excluded.details_at, p.details_at),
    last_seen_at = now(),
    updated_at = now(),
    -- revue dans une recherche : elle existe toujours
    closed_at = null;

  get diagnostics v_count = row_count;

  -- Chaînes : même site sur chain_min fiches ou plus, toutes recherches et tous clients confondus
  select array_agg(distinct x ->> 'site_key') into v_keys
    from jsonb_array_elements(p_places) x
   where nullif(trim(x ->> 'site_key'), '') is not null and nullif(trim(x ->> 'website'), '') is not null;

  if v_keys is not null then
    select chain_min into v_chain_min from public.lm_discovery_settings where id;

    update public.lm_places p set is_chain = true
     where p.site_key = any (v_keys) and not p.is_chain
       and (select count(*) from public.lm_places q where q.site_key = p.site_key) >= coalesce(v_chain_min, 5);
  end if;

  if nullif(p_search ->> 'gcid', '') is not null then
    insert into public.lm_place_searches (country_code, gcid, geoname_id, latitude, longitude, zoom, zone_key, query,
                                          place_ids, cards, complete, source, campaign_id)
    select v_country, p_search ->> 'gcid', (p_search ->> 'geoname_id')::integer,
           (p_search ->> 'latitude')::double precision, (p_search ->> 'longitude')::double precision,
           (p_search ->> 'zoom')::smallint,
           public.lm_place_zone_key((p_search ->> 'geoname_id')::integer, (p_search ->> 'latitude')::double precision,
                                    (p_search ->> 'longitude')::double precision, (p_search ->> 'zoom')::integer),
           left(p_search ->> 'query', 500),
           coalesce((select array_agg(x ->> 'place_id' order by o)
                       from jsonb_array_elements(p_places) with ordinality as e(x, o)
                      where nullif(trim(x ->> 'place_id'), '') is not null
                        and nullif(trim(x ->> 'name'), '') is not null), '{}'),
           jsonb_array_length(p_places), coalesce((p_search ->> 'complete')::boolean, false),
           coalesce(nullif(p_search ->> 'source', ''), 'discovery'),
           (select c.id from public.lm_campaigns c where c.id = (p_search ->> 'campaign_id')::uuid);
  end if;

  return v_count;
end;
$function$
;

grant delete on table "public"."lm_place_searches" to "service_role";

grant insert on table "public"."lm_place_searches" to "service_role";

grant select on table "public"."lm_place_searches" to "service_role";

grant update on table "public"."lm_place_searches" to "service_role";

grant delete on table "public"."lm_places" to "service_role";

grant insert on table "public"."lm_places" to "service_role";

grant select on table "public"."lm_places" to "service_role";

grant update on table "public"."lm_places" to "service_role";


-- Écrit à la main (db diff ne les génère pas) : droits, commentaires
revoke all on public.lm_places from anon, authenticated, service_role;
grant select, insert, update, delete on table public.lm_places to service_role;
revoke all on public.lm_place_searches from anon, authenticated, service_role;
grant select, insert, update, delete on table public.lm_place_searches to service_role;

revoke all on function public.lm_place_zone_key(integer, double precision, double precision, integer) from public;
grant execute on function public.lm_place_zone_key(integer, double precision, double precision, integer) to service_role;
revoke all on function public.lm_record_search_places(jsonb, jsonb) from public;
grant execute on function public.lm_record_search_places(jsonb, jsonb) to service_role;

comment on table public.lm_places is 'Annuaire commun : toutes les fiches vues par les recherches, infos publiques, partagées entre clients (robots seulement)';
comment on table public.lm_place_searches is 'Annuaire commun : registre des recherches (pays × activité × zone) et des fiches trouvées (robots seulement)';
comment on function public.lm_record_search_places(jsonb, jsonb) is 'Annuaire commun : range les fiches vues par une recherche et la note au registre (robots seulement)';

-- Données existantes (CDC §8.2) : les fiches déjà gardées comme prospects, une ligne par fiche (la plus récente
-- si plusieurs espaces l'ont). Coordonnées relues dans le lien de la fiche (« !3d<lat>!4d<lng> »). Les fiches
-- vues mais non gardées avant ce jour n'ont laissé que leur identifiant : rien à récupérer.
insert into public.lm_places (google_place_id, name, category, gcid, address, city, country_code, latitude, longitude,
                              phone, website, site_key, website_known, rating, review_count, maps_url, is_chain,
                              first_seen_at, last_seen_at, updated_at)
select distinct on (pr.google_place_id)
       pr.google_place_id, pr.name, pr.category,
       (select c.gcid from public.lm_categories c where c.label_en = pr.category order by c.gcid limit 1),
       pr.address, pr.city, pr.country_code,
       (substring(pr.maps_url from '!3d(-?[0-9]+(?:\.[0-9]+)?)!4d'))::double precision,
       (substring(pr.maps_url from '!4d(-?[0-9]+(?:\.[0-9]+)?)'))::double precision,
       pr.phone, pr.website, case when pr.website is not null then pr.site_key end, pr.website is not null,
       pr.rating, pr.review_count, pr.maps_url, pr.is_chain, pr.created_at, pr.updated_at, pr.updated_at
  from public.lm_prospects pr
 where pr.source = 'maps' and nullif(trim(pr.google_place_id), '') is not null and pr.country_code is not null
   and length(trim(pr.name)) > 0
 order by pr.google_place_id, pr.updated_at desc
on conflict (google_place_id) do nothing;
