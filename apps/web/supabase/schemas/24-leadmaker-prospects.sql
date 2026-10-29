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
  maps_url varchar(1000),
  source public.lm_prospect_source not null default 'maps',
  campaign_id uuid references public.lm_campaigns(id) on delete set null,
  is_chain boolean not null default false,
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

create policy "lm_prospects_read" on public.lm_prospects for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "lm_prospects_insert" on public.lm_prospects for insert
  to authenticated with check (
    public.has_role_on_account(account_id)
    and exists (select 1 from public.lm_spaces s where s.id = space_id and s.account_id = lm_prospects.account_id)
  );

create policy "restrict_mfa_lm_prospects" on public.lm_prospects
  as restrictive to authenticated using (public.is_mfa_compliant());

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
