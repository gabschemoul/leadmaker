/*
 * -------------------------------------------------------
 * Section: LeadMaker geography
 * Couverture par pays (palier vérifié / standard) et villes GeoNames.
 * -------------------------------------------------------
 */
create table if not exists public.lm_country_coverage (
  country_code char(2) not null,
  name text not null,
  languages text[] not null default '{}',
  tier public.lm_coverage_tier not null default 'standard',
  form_rate numeric(5,4),
  last_corpus_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (country_code),
  constraint lm_country_coverage_code_upper check (country_code = upper(country_code))
);

comment on table public.lm_country_coverage is 'Palier de couverture et taux de formulaires observé par pays';

alter table public.lm_country_coverage enable row level security;

revoke all on public.lm_country_coverage from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_country_coverage to service_role;

grant select on table public.lm_country_coverage to authenticated;

create trigger lm_country_coverage_set_timestamps
  before insert or update on public.lm_country_coverage
  for each row execute function public.trigger_set_timestamps();

create policy "lm_country_coverage_read" on public.lm_country_coverage for select
  to authenticated using (true);

-- Villes du monde (GeoNames, population > 500)
create table if not exists public.lm_geo_cities (
  geoname_id integer not null,
  name text not null,
  ascii_name text not null,
  country_code char(2) not null,
  admin1_code text,
  population integer not null default 0,
  latitude double precision not null,
  longitude double precision not null,
  timezone text,
  primary key (geoname_id)
);

comment on table public.lm_geo_cities is 'Villes GeoNames pour le ciblage géographique mondial';

alter table public.lm_geo_cities enable row level security;

revoke all on public.lm_geo_cities from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_geo_cities to service_role;

grant select on table public.lm_geo_cities to authenticated;

create index if not exists ix_lm_geo_cities_country_population
  on public.lm_geo_cities (country_code, population desc);

create index if not exists ix_lm_geo_cities_ascii_name
  on public.lm_geo_cities (ascii_name text_pattern_ops);

create policy "lm_geo_cities_read" on public.lm_geo_cities for select
  to authenticated using (true);
