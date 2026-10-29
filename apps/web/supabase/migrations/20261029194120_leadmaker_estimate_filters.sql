drop function if exists "public"."lm_estimate_campaign"(p_country_code text, p_targeting jsonb);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_estimate_campaign(p_country_code text, p_targeting jsonb, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(cities integer, categories integer, searches bigint, expected_prospects bigint, rate numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_cities integer;
  v_listings numeric;
  v_categories integer;
  v_share numeric;
  v_reviews integer := coalesce((p_filters ->> 'min_reviews')::integer, 0);
begin
  select count(*)::integer, coalesce(sum(least(120, greatest(5, ceil(t.population / 2000.0)))), 0)
    into v_cities, v_listings
    from public.lm_target_cities(p_country_code, p_targeting) t;

  select count(*)::integer into v_categories from public.lm_target_categories(p_targeting);

  v_share := 0.7 * 0.9
    * public.lm_rating_share(coalesce((p_filters ->> 'rating_min')::numeric, 0), coalesce((p_filters ->> 'rating_max')::numeric, 5))
    * case coalesce(p_filters ->> 'website', 'all') when 'with' then 0.6 when 'without' then 0.4 else 1 end
    * case when v_reviews >= 50 then 0.5 when v_reviews >= 10 then 0.8 else 1 end;

  return query
    select v_cities, v_categories, v_cities::bigint * v_categories,
           round(v_listings * v_categories * v_share)::bigint,
           round(case when v_cities > 0 then v_listings / v_cities * v_share else 0 end, 2);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_rating_share(p_min numeric, p_max numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with bands(lo, hi, share) as (
    values (0.0, 1.0, 0.01), (1.0, 2.0, 0.02), (2.0, 3.0, 0.03), (3.0, 3.5, 0.04),
           (3.5, 4.0, 0.10), (4.0, 4.5, 0.25), (4.5, 5.0, 0.55)
  )
  select 0.85 * coalesce(sum(b.share * greatest(0, least(b.hi, p_max) - greatest(b.lo, p_min)) / (b.hi - b.lo)), 0)
         + case when p_min <= 0 then 0.15 else 0 end
    from bands b;
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
  v_limit integer := least(coalesce((p_targeting ->> 'max_cities')::integer, 20000), 20000);
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



-- migra n'écrit pas les droits d'exécution des fonctions
grant execute on function public.lm_rating_share(numeric, numeric) to authenticated, service_role;
grant execute on function public.lm_estimate_campaign(text, jsonb, jsonb) to authenticated, service_role;
