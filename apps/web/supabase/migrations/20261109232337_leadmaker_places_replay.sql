alter table "public"."lm_discovery_settings" add column "places_max_age_days" integer not null default 90;

alter table "public"."lm_discovery_settings" add column "replay_pacing" jsonb not null default '{"batch": [10, 40], "pause": [3, 8], "min_total": 180, "first_delay": [20, 40]}'::jsonb;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_replay_search(p_country_code text, p_gcid text, p_geoname_id integer, p_latitude double precision, p_longitude double precision, p_zoom integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with s as (
    select ps.id, ps.searched_at, ps.place_ids
      from public.lm_place_searches ps
     where ps.country_code = upper(p_country_code) and ps.gcid = p_gcid
       and ps.zone_key = public.lm_place_zone_key(p_geoname_id, p_latitude, p_longitude, p_zoom)
       and ps.complete
       and ps.searched_at > now() - make_interval(days => (select places_max_age_days from public.lm_discovery_settings where id))
     order by ps.searched_at desc
     limit 1
  )
  select jsonb_build_object(
           'search_id', s.id, 'searched_at', s.searched_at,
           'places', coalesce((select jsonb_agg(jsonb_build_object(
                         'place_id', p.google_place_id, 'name', p.name, 'category', p.category,
                         'rating', p.rating, 'review_count', p.review_count, 'address', p.address, 'phone', p.phone,
                         'website', p.website, 'website_known', p.website_known, 'maps_url', p.maps_url,
                         'latitude', p.latitude, 'longitude', p.longitude, 'is_chain', p.is_chain) order by i.o)
                                 from unnest(s.place_ids) with ordinality as i(id, o)
                                 join public.lm_places p on p.google_place_id = i.id
                                where p.closed_at is null), '[]'::jsonb))
    from s;
$function$
;



-- Écrit à la main (db diff ne les génère pas) : droits
revoke all on function public.lm_replay_search(text, text, integer, double precision, double precision, integer) from public;
grant execute on function public.lm_replay_search(text, text, integer, double precision, double precision, integer) to service_role;
