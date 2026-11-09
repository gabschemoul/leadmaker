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
  constraint lm_prospects_country_code_upper check (country_code is null or country_code = upper(country_code)),
  -- audit A5 : les robots n'ouvrent que des sites web (jamais file://, javascript:, etc.)
  constraint lm_prospects_website_http check (website is null or website ~* '^https?://[^/\s]+')
);

comment on table public.lm_prospects is 'Entreprises découvertes ou importées, uniques par site et par espace';

alter table public.lm_prospects enable row level security;

revoke all on public.lm_prospects from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_prospects to service_role;

-- Lecture seule pour les clients : les prospects arrivent par les robots ou par lm_import_prospects (audit A1 :
-- un INSERT direct permettait de rattacher un prospect à la campagne d'une autre organisation).
grant select on table public.lm_prospects to authenticated;

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
  to authenticated using (account_id in (select public.lm_user_account_ids()));

create policy "restrict_mfa_lm_prospects" on public.lm_prospects
  as restrictive to authenticated using ((select public.is_mfa_compliant()));

-- Adresse de site nettoyée (import CSV, robots) : http(s) gardé, domaine nu complété en https://, le reste
-- (file:, javascript:, texte libre…) devient null. Audit A5.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_clean_website(p_url text) returns text
set search_path = ''
language sql
immutable
as $$
  select case
           when v is null or v = '' then null
           when v ~* '^https?://[^/\s]+' then left(v, 1000)
           when v ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]+)?(/\S*)?$'
             then left('https://' || v, 1000)
         end
    from (select trim(p_url) as v) x;
$$;

grant execute on function public.lm_clean_website(text) to authenticated, service_role;

-- Un prospect ou une prise de contact ne peut être rattaché qu'à une campagne du même espace (audit A1).
-- Appelant : déclencheur (trigger).
create or replace function public.lm_check_campaign_space() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if new.campaign_id is not null and not exists (
       select 1 from public.lm_campaigns c where c.id = new.campaign_id and c.space_id = new.space_id) then
    raise exception 'campaign % is not in space %', new.campaign_id, new.space_id using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.lm_check_campaign_space() from public;

create trigger lm_prospects_check_campaign_space
  before insert or update of campaign_id, space_id on public.lm_prospects
  for each row execute function public.lm_check_campaign_space();

-- Villes et activités présentes dans un espace (pour les filtres de la page Prospects)
-- Appelant : appli (utilisateur connecté).
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
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
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
     where p.id = any (p_ids) and p.excluded_at is null and public.lm_member(p.account_id)
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
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
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
     where p.id = any (p_ids) and p.excluded_at is not null and public.lm_member(p.account_id)
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
-- Appelant : appli (utilisateur connecté).
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
       and coalesce(public.is_mfa_compliant(), false)
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

create trigger lm_attempts_check_campaign_space
  before insert or update of campaign_id, space_id on public.lm_attempts
  for each row execute function public.lm_check_campaign_space();

create index if not exists ix_lm_attempts_campaign_id_status
  on public.lm_attempts (campaign_id, status);

create index if not exists ix_lm_attempts_space_id_status
  on public.lm_attempts (space_id, status);

create index if not exists ix_lm_attempts_account_id
  on public.lm_attempts (account_id);

create policy "lm_attempts_read" on public.lm_attempts for select
  to authenticated using (account_id in (select public.lm_user_account_ids()));

create policy "restrict_mfa_lm_attempts" on public.lm_attempts
  as restrictive to authenticated using ((select public.is_mfa_compliant()));

-- Lien campagne ↔ entreprise (9/11/2026, CDC-PARCOURS-TRI-ANNUAIRE §7). Une entreprise (lm_prospects, unique
-- par espace et par site) peut appartenir à plusieurs campagnes de son espace : groupes (« Créer 3 campagnes »),
-- réutilisation des fiches déjà trouvées. Par campagne : verdict du tri IA, groupe, raison, choix du client et
-- crédits débités. lm_prospects.campaign_id reste la campagne qui l'a trouvée en premier (transition : le code
-- en ligne le lit encore). Le contact reste unique par équipe : lm_attempts (space_id, prospect_id).
create table if not exists public.lm_campaign_prospects (
  campaign_id uuid references public.lm_campaigns(id) on delete cascade not null,
  prospect_id uuid references public.lm_prospects(id) on delete cascade not null,
  account_id uuid references public.accounts(id) on delete cascade not null,
  space_id uuid references public.lm_spaces(id) on delete cascade not null,
  -- Tri IA (étape 3) : gardee | a_verifier | ecartee, groupe de la campagne et raison courte montrée au client
  verdict text,
  group_key text,
  reason text,
  sorted_at timestamptz,
  -- Choix du client à l'écran « Vos entreprises » : il l'emporte sur le verdict
  client_choice text,
  decided_at timestamptz,
  -- Crédits débités pour cette entreprise dans cette campagne (0 : déjà payée par l'équipe, jamais deux fois)
  credits integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (campaign_id, prospect_id),
  constraint lm_campaign_prospects_verdict check (verdict is null or verdict in ('gardee', 'a_verifier', 'ecartee')),
  constraint lm_campaign_prospects_client_choice check (client_choice is null or client_choice in ('gardee', 'ecartee')),
  constraint lm_campaign_prospects_credits check (credits >= 0)
);

comment on table public.lm_campaign_prospects is 'Entreprises de chaque campagne (une entreprise peut être dans plusieurs campagnes de son espace) : tri, choix du client, crédits';

alter table public.lm_campaign_prospects enable row level security;

revoke all on public.lm_campaign_prospects from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_campaign_prospects to service_role;

-- Lecture seule pour les clients : liens posés par les fonctions serveur (robots, tri, groupes)
grant select on table public.lm_campaign_prospects to authenticated;

create index if not exists ix_lm_campaign_prospects_prospect_id on public.lm_campaign_prospects (prospect_id);

create index if not exists ix_lm_campaign_prospects_account_id on public.lm_campaign_prospects (account_id);

create index if not exists ix_lm_campaign_prospects_campaign_id_created_at
  on public.lm_campaign_prospects (campaign_id, created_at desc);

create policy "lm_campaign_prospects_read" on public.lm_campaign_prospects for select
  to authenticated using (account_id in (select public.lm_user_account_ids()));

create policy "restrict_mfa_lm_campaign_prospects" on public.lm_campaign_prospects
  as restrictive to authenticated using ((select public.is_mfa_compliant()));

-- Un lien ne relie qu'une campagne et une entreprise du même espace, et de l'organisation indiquée.
-- Appelant : déclencheur (trigger).
create or replace function public.lm_check_campaign_prospect() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if not exists (select 1 from public.lm_campaigns c
                  where c.id = new.campaign_id and c.space_id = new.space_id and c.account_id = new.account_id)
     or not exists (select 1 from public.lm_prospects p
                     where p.id = new.prospect_id and p.space_id = new.space_id and p.account_id = new.account_id) then
    raise exception 'campaign % and prospect % are not in space %', new.campaign_id, new.prospect_id, new.space_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.lm_check_campaign_prospect() from public;

create trigger lm_campaign_prospects_check_space
  before insert or update of campaign_id, prospect_id, account_id, space_id on public.lm_campaign_prospects
  for each row execute function public.lm_check_campaign_prospect();

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

-- La liste globale (account_id null : entreprises qui ont demandé à ne plus être contactées) n'est lisible
-- par aucun client ; elle est appliquée côté serveur par lm_site_suppressed.
create policy "lm_suppressions_read" on public.lm_suppressions for select
  to authenticated using (account_id is not null and public.has_role_on_account(account_id));

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

-- Site en liste d'opposition (globale, de l'organisation ou de l'espace) ? Vérifié à l'import, à la préparation,
-- par le pilote automatique et avant chaque envoi (audit A10 : avant, seulement à la découverte).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_site_suppressed(p_account_id uuid, p_space_id uuid, p_site_key text)
returns boolean
set search_path = ''
language sql
stable
security definer
as $$
  select exists (select 1 from public.lm_suppressions s
                  where s.site_key = p_site_key
                    and (s.account_id is null
                         or (s.account_id = p_account_id and (s.space_id is null or s.space_id = p_space_id))));
$$;

revoke all on function public.lm_site_suppressed(uuid, uuid, text) from public;

grant execute on function public.lm_site_suppressed(uuid, uuid, text) to service_role;

-- Affichage en direct des prospects trouvés (Supabase Realtime, filtré par la RLS)
alter publication supabase_realtime add table public.lm_prospects;
