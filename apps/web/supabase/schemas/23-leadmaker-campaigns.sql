/*
 * -------------------------------------------------------
 * Section: LeadMaker campaigns and searches
 * -------------------------------------------------------
 */
create table if not exists public.lm_campaigns (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  space_id uuid references public.lm_spaces(id) on delete cascade not null,
  name varchar(255) not null,
  status public.lm_campaign_status not null default 'draft',
  country_code char(2) not null,
  targeting jsonb not null default '{}'::jsonb,   -- zones, villes, rayon, catégories
  filters jsonb not null default '{}'::jsonb,     -- note min/max, avis min, site web, exclusions
  templates jsonb not null default '[]'::jsonb,   -- jusqu'à 4 modèles + variante courte
  daily_limit integer not null default 100,
  auto_validation boolean not null default false,
  -- Roadmap n°13 : crédits de prospection débités par prospect, fixés au premier lancement d'après la
  -- difficulté mesurée par l'estimation (part des entreprises qui passent les filtres) ; figés ensuite.
  credits_per_prospect integer not null default 1,
  -- Estimation (lm_estimates) qui a servi à fixer ce tarif (pas de clé étrangère : la table est déclarée après)
  estimate_id uuid,
  -- Expéditeur choisi pour cette campagne (même espace, contrôlé par lm_campaigns_check_sender) ;
  -- null = l'expéditeur par défaut de l'espace (lm_campaign_sender)
  sender_id uuid references public.lm_sender_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_campaigns_name_not_blank check (length(trim(name)) > 0),
  constraint lm_campaigns_country_code_upper check (country_code = upper(country_code)),
  constraint lm_campaigns_daily_limit_positive check (daily_limit > 0),
  constraint lm_campaigns_credits_per_prospect check (credits_per_prospect between 1 and 10)
);

comment on table public.lm_campaigns is 'Campagnes de prospection d''un espace';

alter table public.lm_campaigns enable row level security;

revoke all on public.lm_campaigns from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_campaigns to service_role;

grant select, insert, delete on table public.lm_campaigns to authenticated;

-- status ne se change que par lm_start_campaign / lm_pause_campaign (quotas et préparation des zones)
grant update (name, country_code, targeting, filters, templates, daily_limit, auto_validation, sender_id)
  on table public.lm_campaigns to authenticated;

create index if not exists ix_lm_campaigns_sender_id
  on public.lm_campaigns (sender_id) where sender_id is not null;

-- L'expéditeur d'une campagne appartient à son espace (donc à son organisation)
create or replace function public.lm_campaigns_check_sender() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if new.sender_id is not null and not exists (
    select 1 from public.lm_sender_profiles s where s.id = new.sender_id and s.space_id = new.space_id
  ) then
    raise exception 'sender not in campaign space' using errcode = '23514', hint = 'sender_space';
  end if;

  return new;
end;
$$;

revoke all on function public.lm_campaigns_check_sender() from public;

create trigger lm_campaigns_check_sender
  before insert or update of sender_id, space_id on public.lm_campaigns
  for each row execute function public.lm_campaigns_check_sender();

-- Expéditeur d'une campagne : celui qu'elle a choisi, sinon celui par défaut de son espace.
-- Invoker : les membres ne voient que les expéditeurs de leur organisation (RLS) ; les robots (service) tout.
create or replace function public.lm_campaign_sender(p_campaign_id uuid)
returns setof public.lm_sender_profiles
set search_path = ''
language sql
stable
as $$
  select s.*
    from public.lm_campaigns c
    join public.lm_sender_profiles s on s.space_id = c.space_id
   where c.id = p_campaign_id
     and (s.id = c.sender_id or (c.sender_id is null and s.is_default))
   limit 1;
$$;

revoke all on function public.lm_campaign_sender(uuid) from public;

grant execute on function public.lm_campaign_sender(uuid) to authenticated, service_role;

create trigger lm_campaigns_set_timestamps
  before insert or update on public.lm_campaigns
  for each row execute function public.trigger_set_timestamps();

create trigger lm_campaigns_set_user_tracking
  before insert or update on public.lm_campaigns
  for each row execute function public.trigger_set_user_tracking();

create index if not exists ix_lm_campaigns_space_id_created_at
  on public.lm_campaigns (space_id, created_at desc);

create index if not exists ix_lm_campaigns_account_id
  on public.lm_campaigns (account_id);

create policy "lm_campaigns_read" on public.lm_campaigns for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "lm_campaigns_insert" on public.lm_campaigns for insert
  to authenticated with check (
    public.has_role_on_account(account_id)
    and exists (select 1 from public.lm_spaces s where s.id = space_id and s.account_id = lm_campaigns.account_id)
  );

create policy "lm_campaigns_update" on public.lm_campaigns for update
  to authenticated using (public.has_role_on_account(account_id))
  with check (public.has_role_on_account(account_id));

create policy "lm_campaigns_delete" on public.lm_campaigns for delete
  to authenticated using (
    public.has_permission((select auth.uid()), account_id, 'settings.manage'::public.app_permissions)
  );

create policy "restrict_mfa_lm_campaigns" on public.lm_campaigns
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Une recherche Google Maps exécutée (catégorie × zone × vague)
create table if not exists public.lm_searches (
  id bigint generated always as identity,
  account_id uuid references public.accounts(id) on delete cascade not null,
  campaign_id uuid references public.lm_campaigns(id) on delete cascade not null,
  country_code char(2) not null,
  category text not null,
  zone_key text not null,
  wave integer not null default 1,
  cards_seen integer not null default 0,
  cards_new integer not null default 0,
  cards_kept integer not null default 0,
  duration_ms integer,
  error text,
  -- Trafic réseau réel de la recherche à travers le proxy (octets), ajouté après coup par lm_add_search_bytes
  proxy_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (id),
  constraint lm_searches_unique_per_wave unique (campaign_id, category, zone_key, wave)
);

comment on table public.lm_searches is 'Journal des recherches Google Maps et de leur rendement';

alter table public.lm_searches enable row level security;

revoke all on public.lm_searches from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_searches to service_role;

grant select on table public.lm_searches to authenticated;

create index if not exists ix_lm_searches_campaign_id_created_at
  on public.lm_searches (campaign_id, created_at desc);

create policy "lm_searches_read" on public.lm_searches for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_searches" on public.lm_searches
  as restrictive to authenticated using (public.is_mfa_compliant());
