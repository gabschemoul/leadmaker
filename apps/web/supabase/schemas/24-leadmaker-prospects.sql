/*
 * -------------------------------------------------------
 * Section: LeadMaker prospects, attempts, replies, suppressions
 * -------------------------------------------------------
 */
create table if not exists public.lm_prospects (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  space_id uuid references public.lm_spaces(id) on delete cascade not null,
  google_place_id text,
  name varchar(500) not null,
  category varchar(255),
  rating numeric(2,1),
  review_count integer,
  address text,
  country_code char(2),
  phone varchar(50),
  website varchar(1000),
  site_key text not null,              -- domaine normalisé, clé de dédoublonnage
  found_email varchar(320),
  email_checked_at timestamptz,        -- dernière recherche d'e-mail sur le site (même sans résultat)
  maps_url varchar(1000),
  source public.lm_prospect_source not null default 'maps',
  campaign_id uuid references public.lm_campaigns(id) on delete set null,
  is_chain boolean not null default false,
  city text,                           -- ville ciblée par la recherche (ou colonne du fichier importé)
  excluded_at timestamptz,             -- exclu par l'utilisateur : jamais contacté, site en liste d'opposition
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_prospects_site_key_unique_per_space unique (space_id, site_key),
  constraint lm_prospects_site_key_not_blank check (length(trim(site_key)) > 0),
  constraint lm_prospects_country_code_upper check (country_code is null or country_code = upper(country_code))
);

comment on table public.lm_prospects is 'Entreprises découvertes ou importées, uniques par site et par espace';

alter table public.lm_prospects enable row level security;

revoke all on public.lm_prospects from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_prospects to service_role;

grant select, insert on table public.lm_prospects to authenticated;

create trigger lm_prospects_set_timestamps
  before insert or update on public.lm_prospects
  for each row execute function public.trigger_set_timestamps();

create trigger lm_prospects_set_user_tracking
  before insert or update on public.lm_prospects
  for each row execute function public.trigger_set_user_tracking();

create index if not exists ix_lm_prospects_space_id_created_at
  on public.lm_prospects (space_id, created_at desc);

create index if not exists ix_lm_prospects_space_id_google_place_id
  on public.lm_prospects (space_id, google_place_id);

create index if not exists ix_lm_prospects_account_id
  on public.lm_prospects (account_id);

create index if not exists ix_lm_prospects_campaign_id_created_at
  on public.lm_prospects (campaign_id, created_at desc);

create index if not exists ix_lm_prospects_space_id_category on public.lm_prospects (space_id, category);

create index if not exists ix_lm_prospects_space_id_city on public.lm_prospects (space_id, city);

create index if not exists ix_lm_prospects_space_id_rating on public.lm_prospects (space_id, rating);

create index if not exists ix_lm_prospects_space_id_name on public.lm_prospects (space_id, name);

create policy "lm_prospects_read" on public.lm_prospects for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "lm_prospects_insert" on public.lm_prospects for insert
  to authenticated with check (
    public.has_role_on_account(account_id)
    and exists (select 1 from public.lm_spaces s where s.id = space_id and s.account_id = lm_prospects.account_id)
  );

create policy "restrict_mfa_lm_prospects" on public.lm_prospects
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Villes et activités présentes dans un espace (pour les filtres de la page Prospects)
create or replace function public.lm_prospect_facets(p_space_id uuid)
returns table (kind text, value text, total bigint)
set search_path = ''
language sql
stable
as $$
  select 'category', p.category, count(*) from public.lm_prospects p
   where p.space_id = p_space_id and p.category is not null group by p.category
  union all
  select 'city', p.city, count(*) from public.lm_prospects p
   where p.space_id = p_space_id and p.city is not null group by p.city
  union all
  select 'campaign', c.id::text, count(*) from public.lm_prospects p
    join public.lm_campaigns c on c.id = p.campaign_id
   where p.space_id = p_space_id group by c.id
  order by 1, 3 desc, 2;
$$;

grant execute on function public.lm_prospect_facets(uuid) to authenticated, service_role;

-- Exclusion : les prospects ne seront jamais contactés et leur site rejoint la liste d'opposition de l'espace
create or replace function public.lm_exclude_prospects(p_ids uuid[]) returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  with target as (
    select p.id, p.account_id, p.space_id, p.site_key
      from public.lm_prospects p
     where p.id = any (p_ids) and p.excluded_at is null and public.has_role_on_account(p.account_id)
  ), upd as (
    update public.lm_prospects p set excluded_at = now()
      from target t where p.id = t.id
    returning t.account_id, t.space_id, t.site_key
  ), sup as (
    insert into public.lm_suppressions (account_id, space_id, site_key, reason)
    select distinct u.account_id, u.space_id, u.site_key, 'excluded'
      from upd u where u.site_key not like 'maps:%' and u.site_key not like 'tel:%'
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$$;

revoke all on function public.lm_exclude_prospects(uuid[]) from public;

grant execute on function public.lm_exclude_prospects(uuid[]) to authenticated, service_role;

-- Retour en liste : exclusion annulée et site retiré de la liste d'opposition de l'espace
create or replace function public.lm_restore_prospects(p_ids uuid[]) returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  with target as (
    select p.id, p.space_id, p.site_key
      from public.lm_prospects p
     where p.id = any (p_ids) and p.excluded_at is not null and public.has_role_on_account(p.account_id)
  ), upd as (
    update public.lm_prospects p set excluded_at = null
      from target t where p.id = t.id
    returning t.space_id, t.site_key
  ), del as (
    delete from public.lm_suppressions s
     using upd u
     where s.space_id = u.space_id and s.site_key = u.site_key and s.reason = 'excluded'
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$$;

revoke all on function public.lm_restore_prospects(uuid[]) from public;

grant execute on function public.lm_restore_prospects(uuid[]) to authenticated, service_role;

-- Suppression définitive (réservée aux membres qui gèrent les paramètres de l'organisation)
create or replace function public.lm_delete_prospects(p_ids uuid[]) returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  with del as (
    delete from public.lm_prospects p
     where p.id = any (p_ids)
       and public.has_permission((select auth.uid()), p.account_id, 'settings.manage'::public.app_permissions)
    returning 1
  )
  select count(*) into v_count from del;

  return v_count;
end;
$$;

revoke all on function public.lm_delete_prospects(uuid[]) from public;

grant execute on function public.lm_delete_prospects(uuid[]) to authenticated, service_role;

-- Tentative : un contact préparé puis envoyé pour un prospect
create table if not exists public.lm_attempts (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  space_id uuid references public.lm_spaces(id) on delete cascade not null,
  campaign_id uuid references public.lm_campaigns(id) on delete cascade not null,
  prospect_id uuid references public.lm_prospects(id) on delete cascade not null,
  status public.lm_attempt_status not null default 'pending',
  template_name text,
  template_used text,
  subject text,
  body text,
  form_url varchar(2000),
  filled jsonb not null default '{}'::jsonb,
  missing jsonb not null default '[]'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  protection_type text,
  screenshot_before text,
  screenshot_after text,
  detail text,
  validated_by uuid references auth.users on delete set null,
  validated_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_attempts_prospect_unique_per_space unique (space_id, prospect_id)
);

comment on table public.lm_attempts is 'Tentatives de contact : préparation, validation, envoi, résultat';

alter table public.lm_attempts enable row level security;

revoke all on public.lm_attempts from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_attempts to service_role;

grant select on table public.lm_attempts to authenticated;

create trigger lm_attempts_set_timestamps
  before insert or update on public.lm_attempts
  for each row execute function public.trigger_set_timestamps();

create trigger lm_attempts_set_user_tracking
  before insert or update on public.lm_attempts
  for each row execute function public.trigger_set_user_tracking();

create index if not exists ix_lm_attempts_campaign_id_status
  on public.lm_attempts (campaign_id, status);

create index if not exists ix_lm_attempts_space_id_status
  on public.lm_attempts (space_id, status);

create index if not exists ix_lm_attempts_account_id
  on public.lm_attempts (account_id);

create policy "lm_attempts_read" on public.lm_attempts for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_attempts" on public.lm_attempts
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Réponse de l'entreprise, une par tentative
create table if not exists public.lm_replies (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  attempt_id uuid references public.lm_attempts(id) on delete cascade not null,
  kind public.lm_reply_kind not null,
  source public.lm_reply_source not null default 'manual',
  note text,
  replied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_replies_attempt_unique unique (attempt_id)
);

comment on table public.lm_replies is 'Retour de l''entreprise contactée';

alter table public.lm_replies enable row level security;

revoke all on public.lm_replies from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_replies to service_role;

grant select, insert on table public.lm_replies to authenticated;

grant update (kind, source, note, replied_at) on table public.lm_replies to authenticated;

create trigger lm_replies_set_timestamps
  before insert or update on public.lm_replies
  for each row execute function public.trigger_set_timestamps();

create trigger lm_replies_set_user_tracking
  before insert or update on public.lm_replies
  for each row execute function public.trigger_set_user_tracking();

create index if not exists ix_lm_replies_account_id_replied_at
  on public.lm_replies (account_id, replied_at desc);

create policy "lm_replies_read" on public.lm_replies for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "lm_replies_insert" on public.lm_replies for insert
  to authenticated with check (
    public.has_role_on_account(account_id)
    and exists (select 1 from public.lm_attempts a where a.id = attempt_id and a.account_id = lm_replies.account_id)
  );

create policy "lm_replies_update" on public.lm_replies for update
  to authenticated using (public.has_role_on_account(account_id))
  with check (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_replies" on public.lm_replies
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Suppression : site à ne plus contacter. account_id null = liste globale LeadMaker.
create table if not exists public.lm_suppressions (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade,
  space_id uuid references public.lm_spaces(id) on delete cascade,
  site_key text not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_suppressions_site_key_not_blank check (length(trim(site_key)) > 0),
  constraint lm_suppressions_scope check (space_id is null or account_id is not null)
);

comment on table public.lm_suppressions is 'Liste d''opposition : par espace, par organisation (space_id null) ou globale (account_id null)';

alter table public.lm_suppressions enable row level security;

revoke all on public.lm_suppressions from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_suppressions to service_role;

grant select, insert, delete on table public.lm_suppressions to authenticated;

create trigger lm_suppressions_set_timestamps
  before insert or update on public.lm_suppressions
  for each row execute function public.trigger_set_timestamps();

create trigger lm_suppressions_set_user_tracking
  before insert or update on public.lm_suppressions
  for each row execute function public.trigger_set_user_tracking();

create unique index if not exists ux_lm_suppressions_scope_site_key
  on public.lm_suppressions (coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
                             coalesce(space_id, '00000000-0000-0000-0000-000000000000'::uuid), site_key);

create index if not exists ix_lm_suppressions_site_key on public.lm_suppressions (site_key);

create policy "lm_suppressions_read" on public.lm_suppressions for select
  to authenticated using (account_id is null or public.has_role_on_account(account_id));

create policy "lm_suppressions_insert" on public.lm_suppressions for insert
  to authenticated with check (
    account_id is not null
    and public.has_role_on_account(account_id)
    and (space_id is null
         or exists (select 1 from public.lm_spaces s where s.id = space_id and s.account_id = lm_suppressions.account_id))
  );

create policy "lm_suppressions_delete" on public.lm_suppressions for delete
  to authenticated using (account_id is not null and public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_suppressions" on public.lm_suppressions
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Affichage en direct des prospects trouvés (Supabase Realtime, filtré par la RLS)
alter publication supabase_realtime add table public.lm_prospects;
