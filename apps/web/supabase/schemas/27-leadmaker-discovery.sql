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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  constraint lm_discovery_settings_single_row check (id),
  constraint lm_discovery_settings_positive check (
    prior >= 0 and min_searches > 0 and min_rate >= 0 and chain_min > 1 and max_results > 0 and tasks_per_campaign > 0
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

-- Villes figées au lancement d'une campagne, des plus peuplées aux moins peuplées
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
  primary key (campaign_id, idx)
);

comment on table public.lm_campaign_zones is 'Zones (villes) parcourues par une campagne, figées au lancement';

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
  next_zone_idx integer not null default 0,
  in_flight integer not null default 0,
  searches integer not null default 0,
  cards integer not null default 0,
  cards_new integer not null default 0,
  kept integer not null default 0,
  abandoned boolean not null default false,
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
create or replace function public.lm_city_label(p_name text, p_country_name text) returns text
set search_path = ''
language sql
immutable
as $$
  select p_name || ', ' || p_country_name;
$$;

grant execute on function public.lm_city_label(text, text) to authenticated, service_role;

-- Villes ciblées par une configuration (même règle pour l'estimation et le lancement)
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

-- Zones de recherche d'un ciblage : une par petite ville, un quadrillage pour les villes de 50 000 habitants et plus
create or replace function public.lm_target_zones(p_country_code text, p_targeting jsonb)
returns table (geoname_id integer, label text, population integer, latitude double precision,
               longitude double precision, zoom smallint)
set search_path = ''
language sql
stable
as $$
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
$$;

grant execute on function public.lm_target_zones(text, jsonb) to authenticated, service_role;

-- Catégories ciblées par une configuration
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
$$;

revoke all on function public.lm_start_campaign(uuid) from public;

grant execute on function public.lm_start_campaign(uuid) to authenticated, service_role;

-- Pause : la campagne s'arrête, les recherches en attente sont annulées
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
$$;

revoke all on function public.lm_pause_campaign(uuid, text) from public;

grant execute on function public.lm_pause_campaign(uuid, text) to authenticated, service_role;

-- Planification : pour chaque campagne en cours, réserve les prochaines recherches (catégorie × ville).
-- Catégories jamais essayées d'abord (générales avant les autres), puis par rendement lissé :
--   (fiches retenues + PRIOR × rendement moyen) / (recherches + PRIOR).
-- Une catégorie est abandonnée après MIN_SEARCHES recherches si elle retient moins de MIN_RATE fiche par recherche.
create or replace function public.lm_schedule_discovery() returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_schedule_discovery() from public;

grant execute on function public.lm_schedule_discovery() to service_role;

-- Fiche Google vue : renvoie false si elle l'avait déjà été dans l'espace (à ne pas rouvrir)
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
create or replace function public.lm_site_known(p_space_id uuid, p_site_key text) returns boolean
set search_path = ''
language sql
stable
security definer
as $$
  select exists (select 1 from public.lm_prospects where space_id = p_space_id and site_key = p_site_key)
      or (select count(*) from public.lm_place_sightings where space_id = p_space_id and site_key = p_site_key)
         >= (select chain_min from public.lm_discovery_settings where id);
$$;

revoke all on function public.lm_site_known(uuid, text) from public;

grant execute on function public.lm_site_known(uuid, text) to service_role;

-- Enregistre un prospect découvert et débite un crédit découverte.
-- Renvoie 'kept', 'duplicate' (site déjà présent) ou 'no_credits' (campagne mise en pause).
create or replace function public.lm_record_prospect(p_campaign_id uuid, p_place jsonb) returns text
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_record_prospect(uuid, jsonb) from public;

grant execute on function public.lm_record_prospect(uuid, jsonb) to service_role;

-- Fin d'une recherche : journal, rendement de la catégorie, abandon éventuel
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
         abandoned = cc.abandoned or (
           cc.searches + 1 >= v_settings.min_searches
           and (cc.kept + p_kept) < v_settings.min_rate * (cc.searches + 1)
         )
   where cc.campaign_id = p_campaign_id and cc.gcid = p_gcid;
end;
$$;

revoke all on function public.lm_finish_search(uuid, text, integer, integer, integer, integer, integer, text) from public;

grant execute on function public.lm_finish_search(uuid, text, integer, integer, integer, integer, integer, text) to service_role;

-- Recherche abandonnée définitivement (échecs répétés) : on libère la place sans compter de rendement
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

-- Avancement d'une campagne, lisible par ses membres
create or replace function public.lm_campaign_progress(p_campaign_id uuid)
returns table (zones integer, categories integer, searches_total bigint, searches_done bigint, in_flight bigint,
               abandoned integer, prospects bigint, cards bigint, last_search_at timestamptz)
set search_path = ''
language sql
stable
as $$
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
$$;

grant execute on function public.lm_campaign_progress(uuid) to authenticated, service_role;

-- Import CSV : prospects ajoutés sans crédit, dédoublonnés par site dans l'espace
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
                                     address, country_code, maps_url, source)
    select v_account_id, p_space_id, left(r ->> 'name', 500), left(r ->> 'category', 255), left(r ->> 'phone', 50),
           left(r ->> 'website', 1000), lower(r ->> 'site_key'), left(r ->> 'email', 320), r ->> 'address',
           coalesce(nullif(upper(r ->> 'country_code'), ''), v_country), left(r ->> 'maps_url', 1000), 'csv'
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
