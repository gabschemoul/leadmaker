-- 10/11/2026 : annuaire commun, étape 3 (CDC-PARCOURS-TRI-ANNUAIRE §8.5). Fiches fermées (« fermé définitivement »,
-- absentes de places_missed_to_close recherches complètes de leur zone) et sites morts vus par la préparation :
-- plus proposés par la reprise. Compatible avec les robots actuels (clés « closed », « ended », « site_dead » facultatives).

alter table "public"."lm_discovery_settings" add column "places_missed_to_close" integer not null default 2;

alter table "public"."lm_places" add column "missed_searches" smallint not null default 0;

alter table "public"."lm_places" add column "site_dead_at" timestamp with time zone;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_finish_prepare(p_attempt_id uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prospect uuid;
  v_email text;
  v_attempt record;
begin
  update public.lm_attempts
     set status = (p_result ->> 'status')::public.lm_attempt_status,
         template_name = coalesce(p_result ->> 'template_name', template_name),
         template_used = coalesce(p_result ->> 'template_used', template_used),
         subject = coalesce(p_result ->> 'subject', subject),
         body = coalesce(p_result ->> 'body', body),
         form_url = p_result ->> 'form_url',
         filled = coalesce(p_result -> 'filled', '{}'::jsonb),
         missing = coalesce(p_result -> 'missing', '[]'::jsonb),
         protection_type = p_result ->> 'protection_type',
         screenshot_before = p_result ->> 'screenshot_before',
         detail = p_result ->> 'detail'
   where id = p_attempt_id and status in ('pending', 'preparing')
  returning prospect_id, account_id, campaign_id, status, detail, missing, protection_type, autopilot_id into v_attempt;

  v_prospect := v_attempt.prospect_id;

  if v_prospect is null then
    return false;
  end if;

  -- Validation automatique (option de la campagne + forfait) : seulement un formulaire prêt sans la moindre alerte
  if v_attempt.status = 'ready' and v_attempt.detail is null and v_attempt.protection_type is null
     and coalesce(jsonb_array_length(v_attempt.missing), 0) = 0
     and v_attempt.autopilot_id is null  -- le pilote automatique a ses propres règles (aperçu, pause), plus bas
     and exists (select 1 from public.lm_campaigns c where c.id = v_attempt.campaign_id and c.auto_validation)
     and public.lm_auto_validation_allowed(v_attempt.account_id) then
    update public.lm_attempts
       set status = 'validated', validated_at = now(), validated_by = null
     where id = p_attempt_id;
  end if;

  -- Pilote automatique en marche (roadmap n°18) : un formulaire prêt sans aucun doute est validé et partira
  -- au moment choisi. En aperçu ou en pause, il reste « prêt » (confirmation ou reprise le valideront).
  if v_attempt.autopilot_id is not null
     and public.lm_attempt_is_clean(v_attempt.status, v_attempt.detail, v_attempt.protection_type, v_attempt.missing)
     and exists (select 1 from public.lm_autopilots ap where ap.id = v_attempt.autopilot_id and ap.status = 'running') then
    update public.lm_attempts
       set status = 'validated', validated_at = now(), validated_by = null
     where id = p_attempt_id and status = 'ready';
  end if;

  -- Site mort (domaine à vendre, boutique fermée, domaine introuvable) : noté dans l'annuaire commun pour ne
  -- plus proposer la fiche (CDC §8.5) ; le tri IA le lit comme injoignable. Infos publiques seulement.
  if coalesce((p_result ->> 'site_dead')::boolean, false) then
    update public.lm_places pl
       set site_dead_at = now(), site_status = 'unreachable', site_text = null, site_read_at = now()
      from public.lm_prospects p
     where p.id = v_prospect and pl.google_place_id = p.google_place_id;
  end if;

  -- Email relevé sur le site : enregistré sur le prospect s'il n'en avait pas
  v_email := nullif(trim(coalesce(p_result ->> 'found_email', '')), '');

  if v_email is not null then
    update public.lm_prospects set found_email = v_email where id = v_prospect and found_email is null;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_sort(p_campaign_id uuid, p_prospect_id uuid, p_version integer, p_verdict text, p_group text, p_reason text, p_site_status text DEFAULT NULL::text, p_site_text text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_place_id text;
  v_count integer;
  v_gcid text;
  v_settings public.lm_discovery_settings%rowtype;
begin
  if p_verdict not in ('gardee', 'a_verifier', 'ecartee') then
    raise exception 'invalid verdict %', p_verdict using errcode = 'P0001';
  end if;

  -- Texte du site : pour tous les clients, même si l'avis arrive trop tard
  if p_site_status in ('ok', 'unreachable', 'social') then
    select p.google_place_id into v_place_id from public.lm_prospects p where p.id = p_prospect_id;

    if v_place_id is not null then
      update public.lm_places
         set site_status = p_site_status,
             site_text = case when p_site_status = 'ok' then left(p_site_text, 8000) end,
             site_read_at = now(),
             -- site relu sans souci : il n'est plus mort (étape 3 de l'annuaire)
             site_dead_at = case when p_site_status = 'ok' then null else site_dead_at end
       where google_place_id = v_place_id;
    end if;
  end if;

  update public.lm_campaign_prospects cp
     set verdict = p_verdict,
         -- pas de groupe tant que la campagne n'en a pas (sinon tout serait rangé « autre » et jamais reclassé)
         group_key = case when (select jsonb_array_length(c.sort_groups) from public.lm_campaigns c
                                 where c.id = p_campaign_id) > 0
                          then left(nullif(trim(p_group), ''), 60) end,
         reason = left(nullif(trim(p_reason), ''), 300),
         sorted_at = now(),
         sorted_version = p_version
   where cp.campaign_id = p_campaign_id and cp.prospect_id = p_prospect_id
     and p_version = (select c.sort_version from public.lm_campaigns c where c.id = p_campaign_id)
  returning cp.gcid into v_gcid;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return false;
  end if;

  select * into v_settings from public.lm_discovery_settings where id;

  -- Rendement du tri par activité ; une activité qui ne donne presque que des entreprises hors cible est
  -- abandonnée (la recherche cesse d'y dépenser du proxy)
  if v_gcid is not null then
    update public.lm_campaign_categories cc
       set sorted = cc.sorted + 1,
           sorted_kept = cc.sorted_kept + (p_verdict = 'gardee')::integer,
           abandoned = cc.abandoned
             or (cc.sorted + 1 >= v_settings.sort_abandon_after
                 and (cc.sorted_kept + (p_verdict = 'gardee')::integer)
                       < v_settings.sort_abandon_rate * (cc.sorted + 1))
     where cc.campaign_id = p_campaign_id and cc.gcid = v_gcid;
  end if;

  perform public.lm_measure_sort_price(p_campaign_id);

  if p_verdict = 'gardee' then
    perform public.lm_settle_kept(p_campaign_id, p_prospect_id);

    -- Groupes (§4.3) : assez de gardées et pas encore de groupes → une tâche de proposition (une par cible)
    if (select c.sort_groups = '[]'::jsonb from public.lm_campaigns c where c.id = p_campaign_id)
       and (select count(*) from public.lm_campaign_prospects cp
             where cp.campaign_id = p_campaign_id and cp.sorted_version = p_version and cp.verdict = 'gardee')
           >= v_settings.sort_groups_after then
      insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
      select c.account_id, 'sort',
             jsonb_build_object('action', 'groups', 'campaign_id', c.id, 'version', p_version),
             'sortgroups:' || c.id::text || ':' || p_version::text
        from public.lm_campaigns c where c.id = p_campaign_id
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return true;
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
  v_search_id bigint;
  v_cur_ids text[];
  v_prev record;
  v_missed_to_close integer;
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
           x.latitude, x.longitude, nullif(trim(x.city), '') as city, x.geoname_id, coalesce(x.opened, false) as opened,
           coalesce(x.closed, false) as closed
      from jsonb_to_recordset(p_places) as x(
             place_id text, name text, category text, rating numeric, review_count integer, address text,
             phone text, website text, website_known boolean, site_key text, maps_url text,
             latitude double precision, longitude double precision, city text, geoname_id integer, opened boolean,
             closed boolean)
     where nullif(trim(x.place_id), '') is not null and nullif(trim(x.name), '') is not null
     order by x.place_id, x.opened desc nulls last
  )
  insert into public.lm_places as p (google_place_id, name, category, gcid, address, city, geoname_id, country_code,
                                     latitude, longitude, phone, website, site_key, website_known, rating,
                                     review_count, maps_url, details_at, closed_at)
  select s.place_id, s.name, s.category,
         (select c.gcid from public.lm_categories c where c.label_en = s.category order by c.gcid limit 1),
         s.address, s.city, s.geoname_id, v_country, s.latitude, s.longitude, s.phone, s.website,
         case when s.website is not null then s.site_key end, s.website_known or s.website is not null,
         s.rating, s.review_count, s.maps_url, case when s.opened then now() end, case when s.closed then now() end
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
    -- revue dans une recherche : elle existe toujours, sauf si Google l'affiche fermée définitivement
    closed_at = case when excluded.closed_at is not null then coalesce(p.closed_at, excluded.closed_at) end,
    missed_searches = 0;

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
           (select c.id from public.lm_campaigns c where c.id = (p_search ->> 'campaign_id')::uuid)
    returning id, place_ids into v_search_id, v_cur_ids;

    -- Étape 3 : fiches disparues. Seulement si cette recherche est complète et lue jusqu'au bout (sinon une
    -- fiche absente peut juste être plus bas dans la liste), et si elle n'a pas fondu de moitié par rapport à
    -- la précédente (page mal chargée).
    if coalesce((p_search ->> 'complete')::boolean, false) and coalesce((p_search ->> 'ended')::boolean, false) then
      select ps.id, ps.cards into v_prev
        from public.lm_place_searches ps, public.lm_place_searches cur
       where cur.id = v_search_id and ps.id <> cur.id and ps.complete
         and ps.country_code = cur.country_code and ps.gcid = cur.gcid and ps.zone_key = cur.zone_key
       order by ps.searched_at desc, ps.id desc
       limit 1;

      if v_prev.id is not null and jsonb_array_length(p_places) * 2 >= v_prev.cards then
        select coalesce(places_missed_to_close, 2) into v_missed_to_close from public.lm_discovery_settings where id;

        update public.lm_places p
           set missed_searches = least(p.missed_searches + 1, 100),
               closed_at = case when p.missed_searches + 1 >= coalesce(v_missed_to_close, 2)
                                then coalesce(p.closed_at, now()) else p.closed_at end
         where p.google_place_id in (
                 select unnest(ps.place_ids)
                   from (select q.place_ids from public.lm_place_searches q, public.lm_place_searches cur
                          where cur.id = v_search_id and q.id <> cur.id and q.complete
                            and q.country_code = cur.country_code and q.gcid = cur.gcid and q.zone_key = cur.zone_key
                          order by q.searched_at desc, q.id desc
                          limit 10) ps)
           and not (p.google_place_id = any (v_cur_ids))
           and p.last_seen_at < now() - interval '7 days';
      end if;
    end if;
  end if;

  return v_count;
end;
$function$
;

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
                                where p.closed_at is null
                                  and (p.site_dead_at is null
                                       or p.site_dead_at <= now() - make_interval(days => (
                                            select places_max_age_days from public.lm_discovery_settings where id)))),
                              '[]'::jsonb))
    from s;
$function$
;


