/*
 * -------------------------------------------------------
 * Section: LeadMaker discovery (lot 1)
 * Catégories Google, zones d'une campagne, rendement par catégorie,
 * planification des recherches et enregistrement des prospects.
 *
 * targeting (jsonb d'une campagne) :
 *   { "cities": { "mode": "country", "min_population": 0, "max_population": null }
 *             | { "mode": "list", "geoname_ids": [123, 456] }
 *             | { "mode": "radius", "geoname_id": 123, "radius_km": 30, "min_population": 0 },
 *     "categories": { "mode": "generic" } | { "mode": "all" } | { "mode": "list", "gcids": ["gcid:..."] },
 *     "max_cities": 5000 }
 * filters : { "rating_min": 0.8, "rating_max": 3.5, "min_reviews": 1, "website": "with"|"without"|"all",
 *             "exclude_public": true, "extra_exclusions": ["mot", ...] }
 * -------------------------------------------------------
 */

-- Catégories Google Business Profile (référence globale)
create table if not exists public.lm_categories (
  gcid text not null,
  label_en text not null,
  label_fr text not null,
  family text not null,
  is_generic boolean not null default false,
  is_excluded boolean not null default false,
  -- Libellés français + anglais en minuscules, sans accents ni apostrophes ni tirets (recherche d'activité :
  -- « eclairage » trouve « éclairage », « d’éclairage » trouve « d'éclairage »). Même règle que foldSearch() côté app.
  search_key text generated always as (
    btrim(regexp_replace(translate(replace(replace(lower(label_fr || ' ' || label_en), 'œ', 'oe'), 'æ', 'ae'), 'àâäáãåāçéèêëēíìîïñóòôöõøúùûüūýÿğ’‘`´''-', 'aaaaaaaceeeeeiiiinoooooouuuuuyyg      '), '\s+', ' ', 'g'))
  ) stored,
  primary key (gcid)
);

comment on table public.lm_categories is 'Catégories Google Business Profile ; is_generic = scannées en premier, is_excluded = administrations et banques';

alter table public.lm_categories enable row level security;

revoke all on public.lm_categories from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_categories to service_role;

grant select on table public.lm_categories to authenticated;

create index if not exists ix_lm_categories_label_en on public.lm_categories (label_en);

create policy "lm_categories_read" on public.lm_categories for select
  to authenticated using (true);

-- Réglages globaux du scan (une seule ligne), modifiables par l'administration
create table if not exists public.lm_discovery_settings (
  id boolean not null default true,
  prior integer not null default 5,
  min_searches integer not null default 40,
  min_rate numeric(5,4) not null default 0.05,
  chain_min integer not null default 5,
  max_results integer not null default 120,
  tasks_per_campaign integer not null default 2,
  default_rate numeric(6,4) not null default 0.3,
  -- Part des places de recherche réservée aux activités jamais essayées (le reste va à celles qui rapportent)
  explore_share numeric(4,3) not null default 0.25,
  -- Une activité sans aucun prospect après ce nombre de recherches est abandonnée
  abandon_zero_after integer not null default 5,
  -- Roadmap n°13 : crédits par prospect selon la part des entreprises qui passent les filtres (estimation).
  -- Du palier le plus facile au plus difficile : taux >= min_rate → credits. Seuils provisoires, à caler après
  -- une semaine de mesures.
  credit_tiers jsonb not null default '[{"min_rate": 0.10, "credits": 1}, {"min_rate": 0.03, "credits": 2}, {"min_rate": 0.01, "credits": 3}, {"min_rate": 0, "credits": 4}]'::jsonb,
  -- Trafic proxy attendu d'une recherche dont on n'a pas encore de mesure (Mo), pour classer les activités
  -- par prospects par Mo
  default_search_mb numeric(6,2) not null default 4,
  -- Roadmap n°14 : compte au-delà de son budget de proxy du mois → ce nombre de recherches à la fois pour
  -- TOUTES ses campagnes (au lieu de tasks_per_campaign par campagne)
  over_budget_tasks_per_account integer not null default 1,
  -- Poids de la dernière recherche dans le rendement récent d'une activité (moyenne glissante, 3/11/2026) :
  -- le planificateur juge les activités sur leurs dernières recherches, comme l'ancien outil, pour lâcher
  -- vite celles qui s'épuisent (« Hôtel » repassé dans tous les secteurs de Bruxelles déjà vus)
  recent_weight numeric(4,3) not null default 0.3,
  -- Crédit unique (CDC-PARCOURS-TRI-ANNUAIRE §5, 9/11/2026) : campagne avec une cible en mots, prix d'une
  -- entreprise gardée selon la part de gardées par le tri IA, mesurée sur les sort_measure_size premières
  -- entreprises triées puis figée. Du palier le plus facile au plus difficile ; sous sort_pause_rate, la
  -- campagne se met en pause (le client doit préciser sa cible).
  sort_measure_size integer not null default 300,
  sort_credit_tiers jsonb not null default '[{"min_rate": 0.25, "credits": 1}, {"min_rate": 0.12, "credits": 2}, {"min_rate": 0.06, "credits": 4}]'::jsonb,
  sort_pause_rate numeric(4,3) not null default 0.06,
  -- Activité abandonnée quand, après sort_abandon_after entreprises triées, moins de sort_abandon_rate sont
  -- gardées : la recherche cesse de dépenser du proxy pour une activité hors cible
  sort_abandon_after integer not null default 40,
  sort_abandon_rate numeric(4,3) not null default 0.03,
  -- Groupes (§4.3) : proposés une fois que la campagne a ce nombre d'entreprises gardées
  sort_groups_after integer not null default 100,
  -- Annuaire commun, étape 2 (CDC §8.3) : une recherche (pays × activité × zone) faite il y a moins de ce nombre de
  -- jours est reprise de l'annuaire, sans proxy
  places_max_age_days integer not null default 90,
  -- Annuaire, étape 3 : absences d'une fiche dans de nouvelles recherches complètes de sa zone avant de la
  -- considérer fermée (CDC §8.5). 2 : Google varie un peu d'une recherche à l'autre.
  places_missed_to_close integer not null default 2,
  -- Arrivée progressive des fiches reprises de l'annuaire (CDC §8.4, décidé le 9/11) : premières fiches après
  -- first_delay secondes (tirage), puis des paquets de batch fiches examinées toutes les pause secondes (tirage
  -- à chaque paquet), une campagne entièrement reprise ne finissant jamais en moins de min_total secondes
  replay_pacing jsonb not null default '{"first_delay": [20, 40], "batch": [10, 40], "pause": [3, 8], "min_total": 180}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  constraint lm_discovery_settings_single_row check (id),
  constraint lm_discovery_settings_search_mb check (default_search_mb > 0),
  constraint lm_discovery_settings_over_budget check (over_budget_tasks_per_account > 0),
  constraint lm_discovery_settings_recent_weight check (recent_weight > 0 and recent_weight <= 1),
  constraint lm_discovery_settings_positive check (
    prior >= 0 and min_searches > 0 and min_rate >= 0 and chain_min > 1 and max_results > 0 and tasks_per_campaign > 0
  ),
  constraint lm_discovery_settings_explore check (
    explore_share >= 0 and explore_share <= 1 and abandon_zero_after > 0
  )
);

comment on table public.lm_discovery_settings is 'Réglages du moteur de découverte : lissage, abandon des catégories, chaînes';

alter table public.lm_discovery_settings enable row level security;

revoke all on public.lm_discovery_settings from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_discovery_settings to service_role;

grant select on table public.lm_discovery_settings to authenticated;

create trigger lm_discovery_settings_set_timestamps
  before insert or update on public.lm_discovery_settings
  for each row execute function public.trigger_set_timestamps();

create policy "lm_discovery_settings_read" on public.lm_discovery_settings for select
  to authenticated using (true);

-- Villes figées au lancement d'une campagne. Ordre de passage (pos, 4/11/2026) : d'abord une recherche par
-- ville, des plus peuplées aux moins peuplées (« Hotel in Brussels », comme l'ancien bot), ensuite seulement
-- les secteurs des grandes villes, en alternant les villes (secteur 1 de chacune, puis secteur 2…).
create table if not exists public.lm_campaign_zones (
  campaign_id uuid references public.lm_campaigns(id) on delete cascade not null,
  idx integer not null,
  account_id uuid references public.accounts(id) on delete cascade not null,
  geoname_id integer not null,
  label text not null,
  population integer not null default 0,
  -- Grandes villes : recherche centrée sur un point de la carte (quadrillage), sinon recherche par nom de ville
  latitude double precision,
  longitude double precision,
  zoom smallint,
  -- Ville retirée du ciblage après le lancement : sautée par la planification, les recherches faites restent
  removed boolean not null default false,
  -- Ordre de passage de chaque activité (lm_campaign_categories.next_zone_idx est une position dans cet
  -- ordre). idx reste l'identité de la zone : il figure dans les tâches et leur clé d'unicité.
  pos integer not null,
  primary key (campaign_id, idx),
  constraint lm_campaign_zones_pos_unique unique (campaign_id, pos)
);

comment on table public.lm_campaign_zones is 'Zones (villes) parcourues par une campagne, fixées au lancement puis complétées à chaque modification du ciblage';

alter table public.lm_campaign_zones enable row level security;

revoke all on public.lm_campaign_zones from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_campaign_zones to service_role;

grant select on table public.lm_campaign_zones to authenticated;

create index if not exists ix_lm_campaign_zones_account_id on public.lm_campaign_zones (account_id);

create policy "lm_campaign_zones_read" on public.lm_campaign_zones for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_campaign_zones" on public.lm_campaign_zones
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Avancement et rendement de chaque catégorie dans une campagne
create table if not exists public.lm_campaign_categories (
  campaign_id uuid references public.lm_campaigns(id) on delete cascade not null,
  gcid text references public.lm_categories(gcid) on delete cascade not null,
  account_id uuid references public.accounts(id) on delete cascade not null,
  is_generic boolean not null default false,
  -- Prochaine zone à chercher : position dans l'ordre de passage (lm_campaign_zones.pos)
  next_zone_idx integer not null default 0,
  in_flight integer not null default 0,
  searches integer not null default 0,
  cards integer not null default 0,
  cards_new integer not null default 0,
  kept integer not null default 0,
  -- Trafic réseau réel consommé par les recherches de cette activité (octets, proxy facturé au poids) :
  -- le planificateur classe les activités par prospects par Mo, pas par recherche (« Hotel » rapporte
  -- mais coûte ~35 Mo par recherche, roadmap n°13)
  proxy_bytes bigint not null default 0,
  -- Prospects gardés par recherche, en moyenne glissante sur les dernières recherches (poids
  -- lm_discovery_settings.recent_weight pour la dernière) ; null tant que l'activité n'a pas été cherchée
  recent_kept numeric,
  -- Tri IA (campagne avec une cible) : entreprises de cette activité triées / gardées, pour la cible en cours
  sorted integer not null default 0,
  sorted_kept integer not null default 0,
  abandoned boolean not null default false,
  -- Activité retirée du ciblage après le lancement
  removed boolean not null default false,
  primary key (campaign_id, gcid)
);

comment on table public.lm_campaign_categories is 'Curseur de zone et rendement (fiches retenues par recherche) de chaque catégorie';

alter table public.lm_campaign_categories enable row level security;

revoke all on public.lm_campaign_categories from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_campaign_categories to service_role;

grant select on table public.lm_campaign_categories to authenticated;

create index if not exists ix_lm_campaign_categories_account_id on public.lm_campaign_categories (account_id);

create policy "lm_campaign_categories_read" on public.lm_campaign_categories for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_campaign_categories" on public.lm_campaign_categories
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Fiches Google déjà vues dans un espace (jamais retraitées) et comptage des sites pour repérer les chaînes
create table if not exists public.lm_place_sightings (
  space_id uuid references public.lm_spaces(id) on delete cascade not null,
  google_place_id text not null,
  site_key text,
  kept boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (space_id, google_place_id)
);

comment on table public.lm_place_sightings is 'Fiches Google vues par espace ; sert à ne jamais rouvrir une fiche et à repérer les chaînes';

alter table public.lm_place_sightings enable row level security;

revoke all on public.lm_place_sightings from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_place_sightings to service_role;

create index if not exists ix_lm_place_sightings_site_key on public.lm_place_sightings (space_id, site_key);

-- Libellé de recherche d'une ville : « Lyon, France »
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_city_label(p_name text, p_country_name text) returns text
set search_path = ''
language sql
immutable
as $$
  select p_name || ', ' || p_country_name;
$$;

grant execute on function public.lm_city_label(text, text) to authenticated, service_role;

-- Villes ciblées par une configuration (même règle pour l'estimation et le lancement)
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_target_cities(p_country_code text, p_targeting jsonb)
returns table (geoname_id integer, label text, population integer)
set search_path = ''
language plpgsql
stable
as $$
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
$$;

grant execute on function public.lm_target_cities(text, jsonb) to authenticated, service_role;

-- Google Maps n'affiche jamais plus de 120 fiches par recherche. Dans une grande ville, une seule recherche
-- en manque la plupart : on la découpe en secteurs (points espacés de 2,5 km, vue zoom 15 ≈ 3,5 km de large)
-- couvrant un disque dont le rayon croît avec la population (2 à 12 km).
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_city_grid(p_lat double precision, p_lng double precision, p_population integer)
returns table (latitude double precision, longitude double precision)
set search_path = ''
language sql
immutable
as $$
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
$$;

grant execute on function public.lm_city_grid(double precision, double precision, integer) to authenticated, service_role;

-- Zones de recherche d'un ciblage : une recherche par nom pour chaque ville, plus un quadrillage pour les villes
-- de 50 000 habitants et plus (Google n'affiche que 120 fiches par recherche)
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_target_zones(p_country_code text, p_targeting jsonb)
returns table (geoname_id integer, label text, population integer, latitude double precision,
               longitude double precision, zoom smallint)
set search_path = ''
language sql
stable
as $$
  select t.geoname_id, t.label, t.population, null::double precision, null::double precision, null::smallint
    from public.lm_target_cities(p_country_code, p_targeting) t
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
$$;

grant execute on function public.lm_target_zones(text, jsonb) to authenticated, service_role;

-- Catégories ciblées par une configuration
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_target_categories(p_targeting jsonb)
returns table (gcid text, is_generic boolean)
set search_path = ''
language sql
stable
as $$
  select c.gcid, c.is_generic
    from public.lm_categories c
   where not c.is_excluded
     and case coalesce(p_targeting -> 'categories' ->> 'mode', 'generic')
           when 'all' then true
           when 'list' then c.gcid in (select jsonb_array_elements_text(p_targeting -> 'categories' -> 'gcids'))
           else c.is_generic
         end;
$$;

grant execute on function public.lm_target_categories(jsonb) to authenticated, service_role;

-- Part des fiches Google dont la note tombe dans [p_min, p_max].
-- Répartition approximative des notes sur Google Maps (fiches notées) :
--   <1 : 1 %, 1-2 : 2 %, 2-3 : 3 %, 3-3,5 : 4 %, 3,5-4 : 10 %, 4-4,5 : 25 %, 4,5-5 : 55 %.
-- Environ 15 % des fiches n'ont pas de note ; elles ne comptent que si la note minimale est 0.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_rating_share(p_min numeric, p_max numeric) returns numeric
set search_path = ''
language sql
immutable
as $$
  with bands(lo, hi, share) as (
    values (0.0, 1.0, 0.01), (1.0, 2.0, 0.02), (2.0, 3.0, 0.03), (3.0, 3.5, 0.04),
           (3.5, 4.0, 0.10), (4.0, 4.5, 0.25), (4.5, 5.0, 0.55)
  )
  select 0.85 * coalesce(sum(b.share * greatest(0, least(b.hi, p_max) - greatest(b.lo, p_min)) / (b.hi - b.lo)), 0)
         + case when p_min <= 0 then 0.15 else 0 end
    from bands b;
$$;

grant execute on function public.lm_rating_share(numeric, numeric) to authenticated, service_role;

-- Estimation avant lancement : villes, recherches et prospects attendus selon la taille des villes et les filtres.
-- Mesure du 29/10/2026 sur les plombiers de Lyon : 210 fiches sur 3 secteurs du centre, 7 % notées de 0,8 à 3,5,
-- 75 % avec un site. 70 % de densité moyenne d'une activité, 10 % d'exclusions (chaînes, administrations).
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_estimate_campaign(p_country_code text, p_targeting jsonb, p_filters jsonb default '{}')
returns table (cities integer, categories integer, searches bigint, expected_prospects bigint, rate numeric)
set search_path = ''
language plpgsql
stable
as $$
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
$$;

grant execute on function public.lm_estimate_campaign(text, jsonb, jsonb) to authenticated, service_role;

-- Lancement : vérifie les droits et quotas, fige les zones et les catégories, passe la campagne en cours
-- Remet in_flight de chaque activité au nombre réel de recherches en file ou en cours.
-- Utilisé à la reprise d'une campagne et par les scripts d'entretien (compteurs désynchronisés).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_recount_in_flight(p_campaign_id uuid) returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_fixed integer;
begin
  with real_tasks as (
    select t.payload ->> 'gcid' as gcid, count(*)::integer as cnt
      from public.lm_tasks t
     where t.kind = 'discovery' and t.status in ('queued', 'running')
       and t.payload ->> 'campaign_id' = p_campaign_id::text
     group by 1
  ), fixed as (
    update public.lm_campaign_categories cc
       set in_flight = coalesce(r.cnt, 0)
      from public.lm_campaign_categories c2
      left join real_tasks r on r.gcid = c2.gcid
     where c2.campaign_id = p_campaign_id and cc.campaign_id = c2.campaign_id and cc.gcid = c2.gcid
       and cc.in_flight <> coalesce(r.cnt, 0)
    returning 1
  )
  select count(*) into v_fixed from fixed;

  return v_fixed;
end;
$$;

revoke all on function public.lm_recount_in_flight(uuid) from public;

grant execute on function public.lm_recount_in_flight(uuid) to service_role;

-- Lance ou reprend une campagne : vérifie crédits et quota de campagnes actives ; au premier lancement, fige
-- zones, activités et tarif (estimation des 7 derniers jours, sinon mesure en parallèle à 1 crédit).
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_start_campaign(p_campaign_id uuid) returns void
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_limit integer;
  v_running integer;
  v_balance integer;
  v_estimate_id uuid;
  v_credits integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_campaign.status = 'running' then
    return;
  end if;

  if v_campaign.status = 'archived' then
    raise exception 'campaign archived' using errcode = 'P0001', hint = 'archived';
  end if;

  select p.active_campaigns, c.discovery_balance + public.lm_pack_credits(c.account_id) into v_limit, v_balance
    from public.lm_account_credits c left join public.lm_plans p on p.id = c.plan_id
   where c.account_id = v_campaign.account_id;

  if v_balance is null or v_balance <= 0 then
    raise exception 'no discovery credits' using errcode = 'P0001', hint = 'no_credits';
  end if;

  -- un lancement à la fois par organisation : deux lancements simultanés ne dépassent pas le quota (audit A14)
  perform pg_advisory_xact_lock(hashtext('lm_start_campaign:' || v_campaign.account_id::text));

  select count(*) into v_running from public.lm_campaigns
   where account_id = v_campaign.account_id and status = 'running';

  if v_limit is not null and v_running >= v_limit then
    raise exception 'active campaign limit reached' using errcode = 'P0001', hint = 'campaign_limit';
  end if;

  -- Premier lancement : on fige les villes, les catégories et le tarif (crédits par prospect)
  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    -- Campagne avec une cible en mots : son prix se mesure sur les entreprises triées (lm_measure_sort_price).
    -- Plus de recherches d'essai pour elle (11/11/2026) : elles passaient avant ses vraies recherches dans la file
    -- des robots (1 à 2 minutes de « 0 recherche faite »), et leurs fiches étaient jetées puis recherchées à nouveau.
    if nullif(trim(v_campaign.sort_target), '') is null then
      -- Le tarif vient de l'estimation faite avec exactement ce ciblage et ces filtres (roadmap n°13).
      -- Audit A7 : la PLUS CHÈRE des 7 derniers jours (sinon relancer l'estimation jusqu'à tomber sur un
      -- échantillon favorable faisait baisser le tarif).
      select e.id, e.credits_per_prospect into v_estimate_id, v_credits
        from public.lm_estimates e
       where e.account_id = v_campaign.account_id and e.status = 'done'
         and e.created_at > now() - interval '7 days'
         and e.country_code = v_campaign.country_code
         and e.targeting = v_campaign.targeting
         and e.filters = (v_campaign.filters - 'paused_reason')
       order by e.credits_per_prospect desc nulls last, e.created_at desc
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
          v_estimate_id := public.lm_create_estimate(v_campaign.account_id, v_campaign.country_code,
                                                     v_campaign.targeting, v_campaign.filters - 'paused_reason');
        end if;

        update public.lm_campaigns
           set credits_per_prospect = 1, estimate_id = v_estimate_id, price_pending = true
         where id = p_campaign_id;
      end if;
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
$$;

revoke all on function public.lm_start_campaign(uuid) from public;

grant execute on function public.lm_start_campaign(uuid) to authenticated, service_role;

-- Pause : la campagne s'arrête, les recherches en attente sont annulées
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_pause_campaign(p_campaign_id uuid, p_reason text default null) returns void
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from public.lm_campaigns where id = p_campaign_id;

  if v_account_id is null
     or (auth.role() = 'authenticated' and not public.lm_member(v_account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  update public.lm_campaigns
     set status = 'paused',
         filters = case when p_reason is null then filters else filters || jsonb_build_object('paused_reason', p_reason) end
   where id = p_campaign_id and status = 'running';

  -- Les recherches annulées libèrent leur place : in_flight ne compte que les tâches en file ou en cours
  with cancelled as (
    update public.lm_tasks set status = 'cancelled', finished_at = now()
     where kind = 'discovery' and status = 'queued' and payload ->> 'campaign_id' = p_campaign_id::text
    returning payload ->> 'gcid' as gcid
  )
  update public.lm_campaign_categories cc
     set in_flight = greatest(cc.in_flight - n.cnt, 0)
    from (select gcid, count(*)::integer as cnt from cancelled group by gcid) n
   where cc.campaign_id = p_campaign_id and cc.gcid = n.gcid;
end;
$$;

revoke all on function public.lm_pause_campaign(uuid, text) from public;

grant execute on function public.lm_pause_campaign(uuid, text) to authenticated, service_role;

-- Planification : pour chaque campagne en cours, réserve les prochaines recherches (catégorie × ville).
-- Les places (TASKS_PER_CAMPAIGN par campagne) se partagent entre deux régimes :
--   exploration (EXPLORE_SHARE des places, au moins une) : une activité jamais essayée, générales d'abord ;
--   exploitation (le reste) : l'activité qui rapporte le plus EN CE MOMENT, classée par
--     rendement récent (recent_kept, moyenne glissante des dernières recherches) / Mo de proxy attendus
--     par recherche, divisé par (1 + recherches en cours) pour répartir les places entre les meilleures.
--     Avant le 3/11/2026, le classement portait sur tout l'historique : une activité qui avait bien
--     rapporté au début gardait la tête après s'être épuisée (« review cleaner » : 0,6 prospect par
--     recherche dans les secteurs déjà vus de Bruxelles, pendant que d'autres en donnaient 8 à 9).
-- Les activités essayées sans aucun prospect passent en dernier dans les deux régimes ;
-- quand un régime n'a plus de candidate, l'autre prend la place.
-- Abandon (lm_finish_search) : aucun prospect après ABANDON_ZERO_AFTER recherches,
-- ou moins de MIN_RATE fiche par recherche après MIN_SEARCHES recherches.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_schedule_discovery() returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
    select c.id, c.account_id, c.country_code, nullif(trim(c.sort_target), '') is not null as sorted
      from public.lm_campaigns c
     where c.status = 'running'
  loop
    if public.lm_proxy_over_budget(v_campaign.account_id) then
      -- Budget de proxy du mois dépassé (roadmap n°14) : le compte entier n'a plus qu'une poignée de
      -- recherches à la fois, toutes campagnes confondues. Invisible pour le client, la recherche ralentit.
      select v_settings.over_budget_tasks_per_account - count(*) into v_slots
        from public.lm_tasks t
       where t.kind = 'discovery' and t.status in ('queued', 'running')
         and t.account_id = v_campaign.account_id;
    else
      select v_settings.tasks_per_campaign - count(*) into v_slots
        from public.lm_tasks t
       where t.kind = 'discovery' and t.status in ('queued', 'running')
         and t.payload ->> 'campaign_id' = v_campaign.id::text;
    end if;

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
                -- prospects récents par Mo de proxy attendu par recherche (trafic mesuré de l'activité,
                -- sinon le trafic par défaut), partagés entre les recherches déjà en cours
                coalesce(cc.recent_kept, cc.kept::numeric / nullif(cc.searches, 0), 0)
                  / case
                      when cc.proxy_bytes > 0 and cc.searches > 0 then cc.proxy_bytes / 1e6 / cc.searches
                      else v_settings.default_search_mb
                    end
                  / (1 + cc.in_flight)
                  -- campagne triée par l'IA : part de gardées par le tri dans cette activité (lissée), pour
                  -- ne pas dépenser le proxy sur des activités hors cible (CDC §5.3)
                  * case when v_campaign.sorted then (cc.sorted_kept + 1)::numeric / (cc.sorted + 3) else 1 end desc,
                random()
       limit 1
       for update of cc skip locked;

      exit when v_pick.gcid is null;

      -- next_zone_idx : position dans l'ordre de passage (pos), pas l'identité de la zone (idx)
      select * into v_zone from public.lm_campaign_zones
       where campaign_id = v_campaign.id and pos = v_pick.next_zone_idx;

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
$$;

revoke all on function public.lm_schedule_discovery() from public;

grant execute on function public.lm_schedule_discovery() to service_role;

-- Fiche Google vue : renvoie false si elle l'avait déjà été dans l'espace (à ne pas rouvrir)
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_mark_place_seen(p_space_id uuid, p_place_id text, p_site_key text) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_mark_place_seen(uuid, text, text) from public;

grant execute on function public.lm_mark_place_seen(uuid, text, text) to service_role;

-- Site déjà présent dans l'espace, ou chaîne repérée
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_site_known(p_space_id uuid, p_site_key text) returns boolean
set search_path = ''
language sql
stable
security definer
as $$
  select exists (select 1 from public.lm_prospects where space_id = p_space_id and site_key = p_site_key)
      or exists (select 1 from public.lm_suppressions s
                  where s.site_key = p_site_key
                    and (s.account_id is null
                         or (s.account_id = (select account_id from public.lm_spaces where id = p_space_id)
                             and (s.space_id is null or s.space_id = p_space_id))))
      or (select count(*) from public.lm_place_sightings where space_id = p_space_id and site_key = p_site_key)
         >= (select chain_min from public.lm_discovery_settings where id);
$$;

revoke all on function public.lm_site_known(uuid, text) from public;

grant execute on function public.lm_site_known(uuid, text) to service_role;

-- Enregistre un prospect découvert et débite les crédits de prospection de la campagne
-- (credits_per_prospect, fixé au lancement selon la difficulté, roadmap n°13).
-- Renvoie 'kept', 'duplicate' (site déjà présent) ou 'no_credits' (campagne mise en pause).
-- Lien campagne ↔ entreprise (lm_campaign_prospects, CDC §7) : posé pour un prospect gardé (avec les crédits
-- débités) ; une entreprise que l'espace a déjà est liée à cette campagne aussi, sans débit (jamais payée deux
-- fois par une équipe, CDC §5.1).
-- Crédit unique (CDC §5, 9/11/2026) : une campagne avec une cible en mots (sort_target) ne débite rien ici ;
-- l'entreprise est payée quand le tri IA (ou le client) la garde (lm_settle_kept). Sans cible (campagnes créées
-- avant le nouveau parcours), le débit reste à l'enregistrement : 1 entreprise = ses crédits, prise de contact
-- comprise. Crédits épuisés : la campagne se met en pause dans les deux cas.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_record_prospect(p_campaign_id uuid, p_place jsonb) returns text
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_id uuid;
  v_credits integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  insert into public.lm_prospects (account_id, space_id, google_place_id, name, category, rating, review_count,
                                   address, country_code, phone, website, site_key, maps_url, source, campaign_id, city)
  values (v_campaign.account_id, v_campaign.space_id, p_place ->> 'place_id', left(p_place ->> 'name', 500),
          left(p_place ->> 'category', 255), (p_place ->> 'rating')::numeric(2,1), (p_place ->> 'review_count')::integer,
          p_place ->> 'address', v_campaign.country_code, left(p_place ->> 'phone', 50), public.lm_clean_website(p_place ->> 'website'),
          p_place ->> 'site_key', left(p_place ->> 'maps_url', 1000), 'maps', p_campaign_id, left(p_place ->> 'city', 200))
  on conflict (space_id, site_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Déjà dans l'espace (trouvée par une autre campagne ou importée) : liée à cette campagne, sans débit
    insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits, paid_at, gcid)
    select p_campaign_id, p.id, p.account_id, p.space_id, 0, now(), nullif(p_place ->> 'gcid', '')
      from public.lm_prospects p
     where p.space_id = v_campaign.space_id and p.site_key = p_place ->> 'site_key'
    on conflict (campaign_id, prospect_id) do nothing;

    return 'duplicate';
  end if;

  if nullif(trim(v_campaign.sort_target), '') is not null then
    -- Payée plus tard, si le tri la garde ; plus aucun crédit : la recherche s'arrête là
    if coalesce((select c.discovery_balance from public.lm_account_credits c
                  where c.account_id = v_campaign.account_id), 0) + public.lm_pack_credits(v_campaign.account_id) <= 0 then
      delete from public.lm_prospects where id = v_id;
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      return 'no_credits';
    end if;
    v_credits := 0;
    -- pas sur la page Prospects tant qu'elle n'est pas payée (lm_campaign_prospect_listed la rend visible)
    update public.lm_prospects set listed = false where id = v_id;
  else
    v_credits := greatest(v_campaign.credits_per_prospect, 1);

    if not public.lm_debit_credits(v_campaign.account_id, 'discovery', v_credits,
                                   'prospect:' || v_id, 'discovery', p_campaign_id) then
      delete from public.lm_prospects where id = v_id;
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      return 'no_credits';
    end if;
  end if;

  insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits, paid_at, gcid)
  values (p_campaign_id, v_id, v_campaign.account_id, v_campaign.space_id, v_credits,
          case when v_credits > 0 then now() end, nullif(p_place ->> 'gcid', ''))
  -- lien déjà posé par le déclencheur lm_prospects_campaign_link : on le complète
  on conflict (campaign_id, prospect_id) do update
    set credits = excluded.credits, paid_at = excluded.paid_at, gcid = excluded.gcid;

  update public.lm_place_sightings set kept = true
   where space_id = v_campaign.space_id and google_place_id = p_place ->> 'place_id';

  return 'kept';
end;
$$;

revoke all on function public.lm_record_prospect(uuid, jsonb) from public;

grant execute on function public.lm_record_prospect(uuid, jsonb) to service_role;

-- Fin d'une recherche : journal, rendement de la catégorie, abandon éventuel
-- (aucun prospect après ABANDON_ZERO_AFTER recherches, ou moins de MIN_RATE par recherche après MIN_SEARCHES).
-- Une recherche échouée ne passe pas ici (lm_release_search) : elle ne compte pas.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_finish_search(
  p_campaign_id uuid, p_gcid text, p_zone_idx integer,
  p_cards integer, p_new integer, p_kept integer, p_duration_ms integer, p_error text default null
) returns void
set search_path = ''
language plpgsql
security definer
as $$
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
         -- première recherche : son résultat ; sinon moyenne glissante (sans valeur récente, on part de la
         -- moyenne de tout l'historique)
         recent_kept = case
           when cc.searches = 0 then p_kept
           else (1 - v_settings.recent_weight) * coalesce(cc.recent_kept, cc.kept::numeric / cc.searches)
                + v_settings.recent_weight * p_kept
         end,
         -- 11/11/2026 (Gabriel) : toutes les recherches sont faites, une activité n'est plus jamais abandonnée
         -- faute de résultats (Abbaye à Barcelone s'arrêtait après 10 recherches sur 46)
         abandoned = cc.abandoned
   where cc.campaign_id = p_campaign_id and cc.gcid = p_gcid;
end;
$$;

revoke all on function public.lm_finish_search(uuid, text, integer, integer, integer, integer, integer, text) from public;

grant execute on function public.lm_finish_search(uuid, text, integer, integer, integer, integer, integer, text) to service_role;

-- Recherche abandonnée définitivement (échecs répétés) : on libère la place sans compter de rendement
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_release_search(p_campaign_id uuid, p_gcid text) returns void
set search_path = ''
language sql
security definer
as $$
  update public.lm_campaign_categories set in_flight = greatest(in_flight - 1, 0)
   where campaign_id = p_campaign_id and gcid = p_gcid;
$$;

revoke all on function public.lm_release_search(uuid, text) from public;

grant execute on function public.lm_release_search(uuid, text) to service_role;

-- Trafic réseau réel d'une recherche ou d'une estimation (mesuré par le robot sur la carte réseau, essais
-- ratés compris) : ajouté au compteur de période du compte (budget proxy, roadmap n°14) et, pour une
-- recherche de campagne, à son activité et à son journal (classement par prospects par Mo, roadmap n°13).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_add_search_bytes(p_task_id bigint, p_bytes bigint) returns void
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_task public.lm_tasks%rowtype;
begin
  if p_bytes is null or p_bytes <= 0 then
    return;
  end if;

  select * into v_task from public.lm_tasks where id = p_task_id and kind in ('discovery', 'estimate');

  if v_task.id is null then
    return;
  end if;

  update public.lm_account_credits
     set proxy_bytes_period = proxy_bytes_period + p_bytes
   where account_id = v_task.account_id;

  if v_task.kind <> 'discovery' then
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
$$;

revoke all on function public.lm_add_search_bytes(bigint, bigint) from public;

grant execute on function public.lm_add_search_bytes(bigint, bigint) to service_role;

-- Crédits de prospection par prospect selon la part des entreprises qui passent les filtres (roadmap n°13).
-- Paliers dans lm_discovery_settings.credit_tiers ; sans taux mesurable, le palier le plus facile.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_credits_for_rate(p_rate numeric) returns integer
set search_path = ''
language sql
stable
as $$
  select coalesce(
    (select (t ->> 'credits')::integer
       from public.lm_discovery_settings s, jsonb_array_elements(s.credit_tiers) t
      where s.id and p_rate is not null and p_rate >= (t ->> 'min_rate')::numeric
      order by (t ->> 'min_rate')::numeric desc
      limit 1),
    1);
$$;

grant execute on function public.lm_credits_for_rate(numeric) to authenticated, service_role;


-- Avancement d'une campagne, lisible par ses membres
-- Avancement d'une campagne. SECURITY DEFINER : les droits sont vérifiés UNE fois (organisation + double
-- authentification), au lieu du RLS ligne par ligne sur les quartiers et les crédits (3,7 s sur une campagne de
-- 16 000 quartiers, délai de 8 s dépassé sous charge le 3/11/2026). Rôle service ou postgres : accès direct.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_campaign_progress(p_campaign_id uuid)
returns table (zones integer, categories integer, searches_total bigint, searches_done bigint, in_flight bigint,
               abandoned integer, productive integer, prospects bigint, cards bigint, last_search_at timestamptz)
set search_path = ''
language plpgsql
stable
security definer
as $$
declare
  v_account_id uuid;
  v_zones integer;
  -- positions des villes encore ciblées, triées (villes restantes d'une activité : width_bucket)
  v_positions integer[];
begin
  select c.account_id into v_account_id from public.lm_campaigns c where c.id = p_campaign_id;

  if v_account_id is null
     or (coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
         and not (public.has_role_on_account(v_account_id) and public.is_mfa_compliant())) then
    return;
  end if;

  select count(*)::integer, array_agg(z.pos order by z.pos) into v_zones, v_positions
    from public.lm_campaign_zones z where z.campaign_id = p_campaign_id and not z.removed;

  -- 11/11/2026 : recherches comptées sur les villes encore ciblées (une campagne passée de Villeurbanne à Lyon
  -- affichait « 10 sur 22 » sans rien chercher) ; une activité abandonnée (aucune entreprise ne correspond) ne
  -- compte plus que ses recherches faites (Barcelone « terminée » à « 10 sur 46 »).
  return query
  with removed_done as (
    select s.category, count(*)::integer as n
      from public.lm_searches s
      join public.lm_campaign_zones z on z.campaign_id = s.campaign_id and z.label = s.zone_key and z.removed
     where s.campaign_id = p_campaign_id
     group by s.category
  ), per_category as (
    select cc.*, least(greatest(cc.searches - coalesce(rd.n, 0), 0), v_zones) as done_active
      from public.lm_campaign_categories cc
      left join removed_done rd on rd.category = cc.gcid
     where cc.campaign_id = p_campaign_id
  )
  select v_zones,
         count(cc.gcid) filter (where not cc.removed)::integer,
         -- par activité : faites + en cours + villes ciblées restantes à partir de sa position (une activité qui a
         -- sauté des villes, ou abandonnée avant le 11/11/2026, ne les compte pas)
         coalesce(sum(case
                        when cc.abandoned then least(v_zones, cc.done_active + cc.in_flight)
                        else least(v_zones, cc.done_active + cc.in_flight
                                            + v_zones - coalesce(width_bucket(cc.next_zone_idx - 1, v_positions), 0))
                      end)
                    filter (where not cc.removed), 0)::bigint,
         coalesce(sum(cc.done_active) filter (where not cc.removed), 0)::bigint,
         coalesce(sum(cc.in_flight), 0),
         count(*) filter (where cc.abandoned and not cc.removed)::integer,
         count(*) filter (where cc.kept > 0 and not cc.removed)::integer,
         (select count(*) from public.lm_credit_ledger l
           where l.campaign_id = p_campaign_id and l.kind = 'discovery' and l.delta < 0),
         coalesce(sum(cc.cards), 0),
         (select max(s.created_at) from public.lm_searches s where s.campaign_id = p_campaign_id)
    from per_category cc;
end;
$$;

revoke all on function public.lm_campaign_progress(uuid) from public;

grant execute on function public.lm_campaign_progress(uuid) to authenticated, service_role;

-- Où en est le lancement d'une campagne (11/11/2026 : « 0 recherche faite » pendant 1 à 2 minutes faisait croire à
-- une panne) : recherches en file / en cours, recherches d'autres campagnes passées avant, reprise prévue (plafond
-- de trafic, blocage), mesure du prix en cours. lm_tasks n'est pas lisible par l'appli : lu ici, une seule fois.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member. SECURITY DEFINER, ne renvoie que des nombres.
create or replace function public.lm_campaign_search_phase(p_campaign_id uuid)
returns table (queued integer, running integer, ahead integer, resume_at timestamptz, estimate_done integer,
               estimate_total integer)
set search_path = ''
language plpgsql
stable
security definer
as $$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_queued integer;
  v_running integer;
  v_ready integer;
  v_first record;
  v_ahead integer := 0;
  v_resume timestamptz;
  v_done integer;
  v_total integer;
begin
  select * into v_campaign from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_campaign.id is null then
    return;
  end if;

  select count(*) filter (where t.status = 'queued'),
         count(*) filter (where t.status = 'running'),
         count(*) filter (where t.status = 'queued' and t.run_after <= now()),
         min(t.run_after) filter (where t.status = 'queued' and t.run_after > now())
    into v_queued, v_running, v_ready, v_resume
    from public.lm_tasks t
   where t.kind = 'discovery' and t.payload ->> 'campaign_id' = p_campaign_id::text
     and t.status in ('queued', 'running');

  -- recherches passées avant la première des nôtres (même file, même ordre que lm_claim_task)
  if v_ready > 0 then
    select t.priority, t.created_at into v_first
      from public.lm_tasks t
     where t.kind = 'discovery' and t.payload ->> 'campaign_id' = p_campaign_id::text
       and t.status = 'queued' and t.run_after <= now()
     order by t.priority, t.created_at
     limit 1;

    select count(*)::integer into v_ahead
      from public.lm_tasks t
     where t.status = 'queued' and t.kind in ('discovery', 'estimate') and t.run_after <= now()
       and (t.priority, t.created_at) < (v_first.priority, v_first.created_at);
  end if;

  if v_campaign.price_pending and v_campaign.estimate_id is not null then
    select e.done_searches, e.sample_searches into v_done, v_total
      from public.lm_estimates e where e.id = v_campaign.estimate_id and e.status = 'running';
  end if;

  return query select v_queued, v_running, v_ahead, case when v_ready = 0 then v_resume end, v_done, v_total;
end;
$$;

revoke all on function public.lm_campaign_search_phase(uuid) from public;

grant execute on function public.lm_campaign_search_phase(uuid) to authenticated, service_role;

-- Modification d'une campagne (nom, ciblage, filtres), même après le lancement.
-- Après le lancement : le pays ne change plus ; les villes et activités ajoutées rejoignent la file de scan,
-- celles retirées sont sautées (les recherches déjà faites et les prospects trouvés restent).
-- Une campagne terminée qui reçoit de nouvelles villes repasse en pause, prête à reprendre.
-- Renvoie le statut de la campagne après la mise à jour.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_update_campaign(
  p_campaign_id uuid, p_name text, p_country_code text, p_targeting jsonb, p_filters jsonb
) returns text
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_launched boolean;
  v_next_idx integer;
  v_next_pos integer;
  v_zone_count integer;
  v_reprice boolean;
  v_estimate_id uuid;
  v_added_zones integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  v_launched := exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id);

  if v_launched and upper(p_country_code) <> v_campaign.country_code then
    raise exception 'country cannot change after launch' using errcode = 'P0001', hint = 'country_locked';
  end if;

  -- Audit A2 : après lancement, changer les filtres ou les activités change la difficulté, donc le tarif.
  -- Une nouvelle mesure est lancée ; d'ici là le tarif actuel s'applique, puis le tarif mesuré
  -- (lm_record_estimate_search). L'ancienne mesure éventuelle est abandonnée.
  -- 11/11/2026 : pas de recherches d'essai pour une campagne triée (son prix vient du tri IA)
  v_reprice := v_launched and nullif(trim(v_campaign.sort_target), '') is null and (
    (public.lm_normalize_filters(p_filters) - 'paused_reason') is distinct from (v_campaign.filters - 'paused_reason')
    or array(select t.gcid from public.lm_target_categories(p_targeting) t order by 1)
       is distinct from array(select t.gcid from public.lm_target_categories(v_campaign.targeting) t order by 1));

  update public.lm_campaigns
     set name = p_name,
         country_code = upper(p_country_code),
         targeting = p_targeting,
         -- la raison de pause est gérée par lm_pause_campaign, on la conserve
         filters = p_filters || case when filters ? 'paused_reason'
                                     then jsonb_build_object('paused_reason', filters -> 'paused_reason')
                                     else '{}'::jsonb end
   where id = p_campaign_id;

  if not v_launched then
    return v_campaign.status::text;
  end if;

  if v_reprice then
    if v_campaign.price_pending and v_campaign.estimate_id is not null then
      update public.lm_estimates set status = 'failed', finished_at = now()
       where id = v_campaign.estimate_id and status = 'running';
      update public.lm_tasks set status = 'cancelled', finished_at = now()
       where kind = 'estimate' and status = 'queued' and payload ->> 'estimate_id' = v_campaign.estimate_id::text;
    end if;

    v_estimate_id := public.lm_create_estimate(v_campaign.account_id, v_campaign.country_code, p_targeting,
                                               coalesce(p_filters, '{}') - 'paused_reason');

    update public.lm_campaigns set estimate_id = v_estimate_id, price_pending = true where id = p_campaign_id;
  end if;

  -- Villes : celles qui sortent du ciblage sont sautées, celles qui y reviennent reprennent
  update public.lm_campaign_zones z
     set removed = (z.geoname_id, z.label) not in (
           select t.geoname_id, t.label from public.lm_target_zones(v_campaign.country_code, p_targeting) t)
   where z.campaign_id = p_campaign_id;

  -- Nouvelles villes : à la fin de la file, dans le même ordre qu'au lancement (villes par leur nom, puis secteurs)
  select coalesce(max(idx), -1) + 1, coalesce(max(pos), -1) + 1 into v_next_idx, v_next_pos
    from public.lm_campaign_zones where campaign_id = p_campaign_id;

  insert into public.lm_campaign_zones (campaign_id, idx, pos, account_id, geoname_id, label, population,
                                        latitude, longitude, zoom)
    select p_campaign_id, v_next_idx + z.rn - 1, v_next_pos + z.rn - 1,
           v_campaign.account_id, z.geoname_id, z.label, z.population, z.latitude, z.longitude, z.zoom
      from (select t.*, row_number() over (
                     order by t.latitude is not null, coalesce(substring(t.label from ' · ([0-9]+)$')::integer, 0),
                              t.population desc, t.geoname_id, t.label) as rn
              from public.lm_target_zones(v_campaign.country_code, p_targeting) t
             where not exists (select 1 from public.lm_campaign_zones z
                                where z.campaign_id = p_campaign_id and z.geoname_id = t.geoname_id
                                  and z.label = t.label)) z;

  get diagnostics v_added_zones = row_count;

  -- Activités : même logique. Plus d'abandon depuis le 11/11/2026 ; une activité abandonnée avant, faute du moindre
  -- prospect (Abbaye à Villeurbanne, puis Lyon ajoutée), repart quand des villes sont ajoutées, directement sur ces
  -- nouvelles villes (pas sur les anciennes déjà jugées vides). Celles abandonnées avec des prospects restent.
  if v_added_zones > 0 then
    update public.lm_campaign_categories cc
       set abandoned = false, next_zone_idx = greatest(cc.next_zone_idx, v_next_pos)
     where cc.campaign_id = p_campaign_id and cc.abandoned and cc.kept = 0;
  end if;

  update public.lm_campaign_categories cc
     set removed = cc.gcid not in (select t.gcid from public.lm_target_categories(p_targeting) t)
   where cc.campaign_id = p_campaign_id;

  insert into public.lm_campaign_categories (campaign_id, gcid, account_id, is_generic)
    select p_campaign_id, t.gcid, v_campaign.account_id, t.is_generic
      from public.lm_target_categories(p_targeting) t
  on conflict (campaign_id, gcid) do nothing;

  -- Campagne terminée mais du travail est revenu : elle repasse en pause (« Reprendre » la relance)
  select count(*) into v_zone_count from public.lm_campaign_zones where campaign_id = p_campaign_id;

  if v_campaign.status = 'completed' and exists (
       select 1 from public.lm_campaign_categories cc
        where cc.campaign_id = p_campaign_id and not cc.abandoned and not cc.removed
          and exists (select 1 from public.lm_campaign_zones z
                       where z.campaign_id = p_campaign_id and not z.removed and z.pos >= cc.next_zone_idx)) then
    update public.lm_campaigns set status = 'paused' where id = p_campaign_id;
    return 'paused';
  end if;

  return v_campaign.status::text;
end;
$$;

revoke all on function public.lm_update_campaign(uuid, text, text, jsonb, jsonb) from public;

grant execute on function public.lm_update_campaign(uuid, text, text, jsonb, jsonb) to authenticated;

-- Import CSV : prospects ajoutés sans crédit, dédoublonnés par site dans l'espace
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_import_prospects(p_space_id uuid, p_rows jsonb) returns table (inserted integer, duplicates integer)
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_account_id uuid;
  v_country text;
  v_total integer;
  v_inserted integer;
begin
  select account_id, country_code into v_account_id, v_country from public.lm_spaces where id = p_space_id;

  if v_account_id is null or not public.lm_member(v_account_id) then
    raise exception 'space not found' using errcode = 'P0002';
  end if;

  v_total := jsonb_array_length(p_rows);

  if v_total > 20000 then
    raise exception 'too many rows' using errcode = 'P0001', hint = 'too_many_rows';
  end if;

  -- Audit A5/A10/A16 : adresse de site nettoyée (http(s) seulement), clé de site normalisée (minuscules, sans
  -- « / » final), sites en liste d'opposition importés mais exclus d'office (jamais contactés).
  with src as (
    select distinct on (k.site_key) r, k.site_key
      from jsonb_array_elements(p_rows) r
     cross join lateral (select rtrim(lower(trim(coalesce(r ->> 'site_key', ''))), '/') as site_key) k
     where length(k.site_key) > 0 and length(trim(coalesce(r ->> 'name', ''))) > 0
  ), ins as (
    insert into public.lm_prospects (account_id, space_id, name, category, phone, website, site_key, found_email,
                                     address, country_code, maps_url, source, city, excluded_at)
    select v_account_id, p_space_id, left(r ->> 'name', 500), left(r ->> 'category', 255), left(r ->> 'phone', 50),
           public.lm_clean_website(r ->> 'website'), src.site_key, left(r ->> 'email', 320), left(r ->> 'address', 1000),
           coalesce(nullif(upper(left(r ->> 'country_code', 2)), ''), v_country), left(r ->> 'maps_url', 1000), 'csv',
           left(nullif(trim(r ->> 'city'), ''), 200),
           case when public.lm_site_suppressed(v_account_id, p_space_id, src.site_key) then now() end
      from src
    on conflict (space_id, site_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return query select v_inserted, v_total - v_inserted;
end;
$$;

revoke all on function public.lm_import_prospects(uuid, jsonb) from public;

grant execute on function public.lm_import_prospects(uuid, jsonb) to authenticated, service_role;

-- Recherche des tâches d'une campagne (planification, pause, reprise)
create index if not exists ix_lm_tasks_discovery_campaign
  on public.lm_tasks ((payload ->> 'campaign_id'), status)
  where kind = 'discovery';

-- Affichage en direct de l'avancement des campagnes (Supabase Realtime, filtré par la RLS)
alter publication supabase_realtime add table public.lm_campaign_categories;
