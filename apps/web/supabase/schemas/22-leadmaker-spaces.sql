/*
 * -------------------------------------------------------
 * Section: LeadMaker spaces and sender profiles
 * Un espace = un dossier de prospection cloisonné : prospects, expéditeur, liste « ne plus contacter ».
 * Chaque organisation a un espace par défaut, créé automatiquement et invisible pour qui prospecte
 * pour lui-même ; les agences ajoutent un espace par client final (« Dossiers clients »).
 * -------------------------------------------------------
 */
create table if not exists public.lm_spaces (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  name varchar(255) not null,
  country_code char(2),
  language_code varchar(5) not null default 'en',
  is_default boolean not null default false,
  ready_forms_cap integer not null default 500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_spaces_name_not_blank check (length(trim(name)) > 0),
  constraint lm_spaces_country_code_upper check (country_code = upper(country_code)),
  constraint lm_spaces_ready_forms_cap_positive check (ready_forms_cap > 0),
  -- audit A9 : borne haute (le plafond n'est plus modifiable par les clients)
  constraint lm_spaces_ready_forms_cap_max check (ready_forms_cap <= 500),
  constraint lm_spaces_name_unique_per_account unique (account_id, name)
);

comment on table public.lm_spaces is 'Espaces de travail cloisonnés d''une organisation';

alter table public.lm_spaces enable row level security;

revoke all on public.lm_spaces from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_spaces to service_role;

grant select, delete on table public.lm_spaces to authenticated;

-- audit A9 : colonnes choisies par le client ; is_default et ready_forms_cap restent gérés par le serveur
grant insert (account_id, name, country_code, language_code) on table public.lm_spaces to authenticated;

grant update (name, country_code, language_code) on table public.lm_spaces to authenticated;

create trigger lm_spaces_set_timestamps
  before insert or update on public.lm_spaces
  for each row execute function public.trigger_set_timestamps();

create trigger lm_spaces_set_user_tracking
  before insert or update on public.lm_spaces
  for each row execute function public.trigger_set_user_tracking();

create index if not exists ix_lm_spaces_account_id_created_at
  on public.lm_spaces (account_id, created_at desc);

create policy "lm_spaces_read" on public.lm_spaces for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "lm_spaces_insert" on public.lm_spaces for insert
  to authenticated with check (public.has_role_on_account(account_id));

create policy "lm_spaces_update" on public.lm_spaces for update
  to authenticated using (public.has_role_on_account(account_id))
  with check (public.has_role_on_account(account_id));

create policy "lm_spaces_delete" on public.lm_spaces for delete
  to authenticated using (
    not is_default
    and public.has_permission((select auth.uid()), account_id, 'settings.manage'::public.app_permissions)
  );

-- Un seul espace par défaut par organisation
create unique index if not exists ux_lm_spaces_default_per_account
  on public.lm_spaces (account_id) where is_default;

-- Chaque organisation (compte d'équipe) reçoit son espace par défaut à la création
create or replace function public.lm_create_default_space() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if not new.is_personal_account then
    insert into public.lm_spaces (account_id, name, is_default)
    values (new.id, 'Default', true)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.lm_create_default_space() from public;

create trigger lm_accounts_create_default_space
  after insert on public.accounts
  for each row execute function public.lm_create_default_space();

create policy "restrict_mfa_lm_spaces" on public.lm_spaces
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Quota d'espaces : limite du forfait courant (1 espace sans forfait).
create or replace function public.lm_space_limit(p_account_id uuid) returns integer
set search_path = ''
language sql
stable
security definer
as $$
  select coalesce(p.spaces, 1)
  from public.lm_account_credits c
  left join public.lm_plans p on p.id = c.plan_id
  where c.account_id = p_account_id
  union all
  select 1
  where not exists (select 1 from public.lm_account_credits where account_id = p_account_id)
  limit 1;
$$;

revoke all on function public.lm_space_limit(uuid) from public;

grant execute on function public.lm_space_limit(uuid) to service_role;

create or replace function public.lm_enforce_space_quota() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.lm_spaces where account_id = new.account_id;

  if v_count >= public.lm_space_limit(new.account_id) then
    raise exception 'space quota reached for account %', new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger lm_spaces_space_quota
  before insert on public.lm_spaces
  for each row execute function public.lm_enforce_space_quota();

-- Expéditeurs : plusieurs par espace depuis le 3/11/2026 (« selon la campagne c'est un expéditeur
-- différent »). Un seul par défaut par espace (ux_lm_sender_profiles_default) : il sert aux campagnes qui n'en
-- choisissent pas (lm_campaigns.sender_id null, voir lm_campaign_sender).
create table if not exists public.lm_sender_profiles (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  space_id uuid references public.lm_spaces(id) on delete cascade not null,
  civility varchar(50),
  first_name varchar(100) not null,
  last_name varchar(100) not null,
  job_title varchar(150),
  company varchar(255) not null,
  email varchar(320) not null,
  phone varchar(50),
  website varchar(500),
  address varchar(500),
  zip varchar(20),
  city varchar(150),
  country_code char(2) not null,
  -- Expéditeur par défaut de l'espace : posé par les déclencheurs (le premier l'est d'office, un autre prend
  -- le relais quand il est supprimé) et par lm_set_default_sender, jamais directement par l'utilisateur
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_sender_profiles_country_code_upper check (country_code = upper(country_code)),
  constraint lm_sender_profiles_required_not_blank check (
    length(trim(first_name)) > 0 and length(trim(last_name)) > 0
    and length(trim(company)) > 0 and length(trim(email)) > 0
  )
);

comment on table public.lm_sender_profiles is 'Identités utilisées pour remplir les formulaires (plusieurs par espace, une par défaut)';

alter table public.lm_sender_profiles enable row level security;

revoke all on public.lm_sender_profiles from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_sender_profiles to service_role;

grant select, insert, delete on table public.lm_sender_profiles to authenticated;

grant update (civility, first_name, last_name, job_title, company, email, phone, website, address, zip, city, country_code)
  on table public.lm_sender_profiles to authenticated;

create trigger lm_sender_profiles_set_timestamps
  before insert or update on public.lm_sender_profiles
  for each row execute function public.trigger_set_timestamps();

create trigger lm_sender_profiles_set_user_tracking
  before insert or update on public.lm_sender_profiles
  for each row execute function public.trigger_set_user_tracking();

create index if not exists ix_lm_sender_profiles_account_id
  on public.lm_sender_profiles (account_id);

create index if not exists ix_lm_sender_profiles_space_id
  on public.lm_sender_profiles (space_id, created_at);

create unique index if not exists ux_lm_sender_profiles_default
  on public.lm_sender_profiles (space_id) where is_default;

-- Le premier expéditeur d'un espace est celui par défaut ; les suivants non (quelle que soit la valeur envoyée)
create or replace function public.lm_sender_profiles_default_on_insert() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  new.is_default := not exists (
    select 1 from public.lm_sender_profiles s where s.space_id = new.space_id and s.is_default
  );

  return new;
end;
$$;

revoke all on function public.lm_sender_profiles_default_on_insert() from public;

create trigger lm_sender_profiles_default_on_insert
  before insert on public.lm_sender_profiles
  for each row execute function public.lm_sender_profiles_default_on_insert();

-- Expéditeur par défaut supprimé : le plus ancien des autres prend le relais
create or replace function public.lm_sender_profiles_default_on_delete() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if old.is_default then
    update public.lm_sender_profiles
       set is_default = true
     where id = (select s.id from public.lm_sender_profiles s
                  where s.space_id = old.space_id and s.id <> old.id
                  order by s.created_at, s.id
                  limit 1);
  end if;

  return old;
end;
$$;

revoke all on function public.lm_sender_profiles_default_on_delete() from public;

create trigger lm_sender_profiles_default_on_delete
  after delete on public.lm_sender_profiles
  for each row execute function public.lm_sender_profiles_default_on_delete();

-- Choisit l'expéditeur par défaut de son espace (membre de l'organisation, double authentification à jour)
create or replace function public.lm_set_default_sender(p_sender_id uuid) returns void
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_sender public.lm_sender_profiles%rowtype;
begin
  select * into v_sender from public.lm_sender_profiles where id = p_sender_id;

  if v_sender.id is null
     or (current_setting('role', true) in ('authenticated', 'anon')
         and not (public.has_role_on_account(v_sender.account_id) and public.is_mfa_compliant())) then
    raise exception 'sender not found' using errcode = 'P0002';
  end if;

  -- deux temps : l'index unique partiel n'admet jamais deux expéditeurs par défaut, même un instant
  update public.lm_sender_profiles set is_default = false
   where space_id = v_sender.space_id and is_default and id <> p_sender_id;

  update public.lm_sender_profiles set is_default = true where id = p_sender_id and not is_default;
end;
$$;

revoke all on function public.lm_set_default_sender(uuid) from public;

grant execute on function public.lm_set_default_sender(uuid) to authenticated, service_role;

create policy "lm_sender_profiles_read" on public.lm_sender_profiles for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "lm_sender_profiles_insert" on public.lm_sender_profiles for insert
  to authenticated with check (
    public.has_role_on_account(account_id)
    and exists (select 1 from public.lm_spaces s where s.id = space_id and s.account_id = lm_sender_profiles.account_id)
  );

create policy "lm_sender_profiles_update" on public.lm_sender_profiles for update
  to authenticated using (public.has_role_on_account(account_id))
  with check (public.has_role_on_account(account_id));

-- Supprimer un expéditeur : réservé aux membres qui gèrent les réglages de l'organisation
create policy "lm_sender_profiles_delete" on public.lm_sender_profiles for delete
  to authenticated using (
    public.has_permission((select auth.uid()), account_id, 'settings.manage'::public.app_permissions)
  );

create policy "restrict_mfa_lm_sender_profiles" on public.lm_sender_profiles
  as restrictive to authenticated using (public.is_mfa_compliant());
