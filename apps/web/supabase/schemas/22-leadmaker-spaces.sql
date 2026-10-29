/*
 * -------------------------------------------------------
 * Section: LeadMaker spaces and sender profiles
 * Un espace = un contexte de travail (un client final en mode agence),
 * cloisonné dans l'organisation : expéditeur, campagnes, suppressions.
 * -------------------------------------------------------
 */
create table if not exists public.lm_spaces (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  name varchar(255) not null,
  country_code char(2) not null,
  language_code varchar(5) not null default 'en',
  ready_forms_cap integer not null default 500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_spaces_name_not_blank check (length(trim(name)) > 0),
  constraint lm_spaces_country_code_upper check (country_code = upper(country_code)),
  constraint lm_spaces_ready_forms_cap_positive check (ready_forms_cap > 0),
  constraint lm_spaces_name_unique_per_account unique (account_id, name)
);

comment on table public.lm_spaces is 'Espaces de travail cloisonnés d''une organisation';

alter table public.lm_spaces enable row level security;

revoke all on public.lm_spaces from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_spaces to service_role;

grant select, insert, delete on table public.lm_spaces to authenticated;

grant update (name, country_code, language_code, ready_forms_cap) on table public.lm_spaces to authenticated;

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
    public.has_permission((select auth.uid()), account_id, 'settings.manage'::public.app_permissions)
  );

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

grant execute on function public.lm_space_limit(uuid) to authenticated, service_role;

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

-- Profil expéditeur : un par espace
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_sender_profiles_space_unique unique (space_id),
  constraint lm_sender_profiles_country_code_upper check (country_code = upper(country_code)),
  constraint lm_sender_profiles_required_not_blank check (
    length(trim(first_name)) > 0 and length(trim(last_name)) > 0
    and length(trim(company)) > 0 and length(trim(email)) > 0
  )
);

comment on table public.lm_sender_profiles is 'Identité utilisée pour remplir les formulaires d''un espace';

alter table public.lm_sender_profiles enable row level security;

revoke all on public.lm_sender_profiles from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_sender_profiles to service_role;

grant select, insert on table public.lm_sender_profiles to authenticated;

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

create policy "restrict_mfa_lm_sender_profiles" on public.lm_sender_profiles
  as restrictive to authenticated using (public.is_mfa_compliant());
