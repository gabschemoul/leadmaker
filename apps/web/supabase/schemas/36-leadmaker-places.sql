/*
 * -------------------------------------------------------
 * Section: LeadMaker annuaire commun, étape 1 (9/11/2026, docs/prospectigo/CDC-PARCOURS-TRI-ANNUAIRE.md §8.2)
 * Toutes les fiches vues par les recherches, quel que soit le client et même celles que ses filtres écartent,
 * sont gardées ici. Avant, seules les fiches retenues devenaient des prospects (211 000 sur 481 000 vues au
 * 9/11) : le proxy des autres était payé pour rien. Ces fiches serviront à ne pas refaire une recherche déjà
 * faite (étape 2) et au tri IA (texte du site, lu une seule fois pour tous les clients).
 *
 * Tables COMMUNES à tous les clients, infos publiques seulement : aucune trace de qui a cherché, gardé ou
 * contacté quoi (ça reste dans lm_prospects, propre à chaque espace). Illisibles par les clients (RLS sans
 * politique, aucun droit pour authenticated) : seuls les robots (rôle service) y accèdent.
 * -------------------------------------------------------
 */

-- Une ligne par entreprise (fiche publique), unique par identifiant de fiche Google
create table if not exists public.lm_places (
  google_place_id text not null,
  name varchar(500) not null,
  -- Activité principale affichée sur la fiche (anglais) et sa catégorie quand le libellé est connu
  category varchar(255),
  gcid text,
  address text,
  -- Ville de la recherche qui l'a trouvée, seulement si l'entreprise est bien dans cette ville
  city text,
  geoname_id integer,
  country_code char(2) not null,
  latitude double precision,
  longitude double precision,
  phone varchar(50),
  website varchar(1000),
  site_key text,
  -- Vrai si on sait si elle a un site (bouton visible sur la carte ou fiche ouverte). Faux : liste compacte
  -- de Google, fiche jamais ouverte, `website` vide ne veut pas dire « sans site ».
  website_known boolean not null default false,
  rating numeric(2,1),
  review_count integer,
  maps_url varchar(1000),
  -- Même site sur plusieurs fiches (lm_discovery_settings.chain_min ou plus) : chaîne / franchise
  is_chain boolean not null default false,
  -- Page d'accueil du site lue par le tri IA (étape 3 du CDC), pour ne pas la relire pour chaque client
  site_text text,
  site_status text,
  site_read_at timestamptz,
  first_seen_at timestamptz not null default now(),
  -- Dernière fois que la fiche est apparue dans une recherche
  last_seen_at timestamptz not null default now(),
  -- Dernière ouverture de la fiche complète (adresse, téléphone, site sûrs)
  details_at timestamptz,
  -- Dernière mise à jour des infos de la fiche
  updated_at timestamptz not null default now(),
  -- Entreprise disparue (site mort, fiche absente d'une nouvelle recherche) : plus proposée (étape 3)
  closed_at timestamptz,
  primary key (google_place_id),
  constraint lm_places_country_code_upper check (country_code = upper(country_code)),
  constraint lm_places_website_http check (website is null or website ~* '^https?://[^/\s]+'),
  constraint lm_places_site_status check (site_status is null or site_status in ('ok', 'unreachable', 'social'))
);

comment on table public.lm_places is 'Annuaire commun : toutes les fiches vues par les recherches, infos publiques, partagées entre clients (robots seulement)';

alter table public.lm_places enable row level security;

revoke all on public.lm_places from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_places to service_role;

create index if not exists ix_lm_places_country_code_city on public.lm_places (country_code, city);

create index if not exists ix_lm_places_gcid on public.lm_places (gcid);

create index if not exists ix_lm_places_site_key on public.lm_places (site_key);

-- « Autour d'une ville » : boîte latitude / longitude dans un pays
create index if not exists ix_lm_places_country_code_lat_lng on public.lm_places (country_code, latitude, longitude);

-- Registre des recherches : pour chaque (pays, activité, ville ou secteur), quand elle a été faite et les
-- entreprises trouvées, dans l'ordre de Google. Une ligne par passage (historique), la plus récente fait foi.
create table if not exists public.lm_place_searches (
  id bigint generated always as identity,
  country_code char(2) not null,
  gcid text not null,
  geoname_id integer,
  -- Secteur d'une grande ville (centre de la carte) ; vides pour une recherche par nom de ville
  latitude double precision,
  longitude double precision,
  zoom smallint,
  -- Clé de la zone : « geoname_id » ou « geoname_id@lat,lng,zoom » (coordonnées arrondies à 4 décimales)
  zone_key text not null,
  query text,
  place_ids text[] not null default '{}',
  cards integer not null default 0,
  -- Faux : liste lue en partie (campagne mise en pause, page qui ne s'affiche pas) ; ne vaut pas recherche faite
  complete boolean not null default false,
  source text not null default 'discovery',
  -- Campagne qui l'a déclenchée (suivi interne, jamais montrée à un autre client)
  campaign_id uuid references public.lm_campaigns(id) on delete set null,
  searched_at timestamptz not null default now(),
  primary key (id)
);

comment on table public.lm_place_searches is 'Annuaire commun : registre des recherches (pays × activité × zone) et des fiches trouvées (robots seulement)';

alter table public.lm_place_searches enable row level security;

revoke all on public.lm_place_searches from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_place_searches to service_role;

create index if not exists ix_lm_place_searches_key
  on public.lm_place_searches (country_code, gcid, zone_key, searched_at desc);

create index if not exists ix_lm_place_searches_campaign_id on public.lm_place_searches (campaign_id);

-- Clé de zone d'une recherche (voir lm_place_searches.zone_key)
-- Appelant : robots / serveur uniquement (rôle service), via lm_record_search_places.
create or replace function public.lm_place_zone_key(
  p_geoname_id integer, p_latitude double precision, p_longitude double precision, p_zoom integer
) returns text
set search_path = ''
language sql
immutable
as $$
  select coalesce(p_geoname_id::text, '?')
         || case
              when p_latitude is null or p_longitude is null then ''
              else '@' || round(p_latitude::numeric, 4) || ',' || round(p_longitude::numeric, 4)
                   || ',' || coalesce(p_zoom, 15)
            end;
$$;

revoke all on function public.lm_place_zone_key(integer, double precision, double precision, integer) from public;

grant execute on function public.lm_place_zone_key(integer, double precision, double precision, integer) to service_role;

-- Fin d'une recherche : range toutes les fiches vues dans l'annuaire commun et note la recherche au registre.
-- p_search : { country_code, gcid, geoname_id, latitude, longitude, zoom, query, complete, source, campaign_id }
-- p_places : [{ place_id, name, category, rating, review_count, address, phone, website, website_known,
--               site_key, maps_url, latitude, longitude, city, geoname_id, opened }] dans l'ordre de Google.
-- Mise à jour d'une fiche déjà connue : les infos nouvelles remplacent les anciennes, une info absente ne
-- l'efface pas (une carte de liste n'a pas toujours le téléphone que la fiche ouverte avait donné), sauf le
-- site quand on sait qu'il n'y en a plus. Renvoie le nombre de fiches rangées.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_record_search_places(p_search jsonb, p_places jsonb) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

comment on function public.lm_record_search_places(jsonb, jsonb) is 'Annuaire commun : range les fiches vues par une recherche et la note au registre (robots seulement)';

revoke all on function public.lm_record_search_places(jsonb, jsonb) from public;

grant execute on function public.lm_record_search_places(jsonb, jsonb) to service_role;

-- Annuaire commun, étape 2 (CDC §8.3) : la recherche complète la plus récente de moins de places_max_age_days
-- jours pour ce pays, cette activité et cette zone, avec ses fiches dans l'ordre de Google (fiches fermées
-- exclues). null si aucune : il faut faire la vraie recherche. Rien sur qui l'a faite (jamais montré).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_replay_search(
  p_country_code text, p_gcid text, p_geoname_id integer, p_latitude double precision, p_longitude double precision,
  p_zoom integer
) returns jsonb
set search_path = ''
language sql
stable
security definer
as $$
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
$$;

revoke all on function public.lm_replay_search(text, text, integer, double precision, double precision, integer) from public;

grant execute on function public.lm_replay_search(text, text, integer, double precision, double precision, integer) to service_role;
