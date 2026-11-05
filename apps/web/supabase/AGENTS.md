# Supabase Database

## Prospectigo : à savoir avant toute migration

- **La pré-prod et la prod partagent cette base.** Une migration poussée touche les vrais clients tout de suite :
  elle doit fonctionner avec le code actuellement sur `main` (ajouter d'abord, retirer dans une livraison
  ultérieure). Gabriel pousse lui-même (`! pnpm exec supabase db push`).
- Schémas Prospectigo : `schemas/20-34-leadmaker-*.sql` (source de vérité ; carte dans
  `docs/prospectigo/ARCHITECTURE.md` §5). `db diff` n'écrit ni les `grant`/`revoke` de fonctions ni les droits par
  colonne : les ajouter à la main en fin de migration, puis relancer `db diff` sans `-f` (doit dire « No schema
  changes found »). Les tâches pg_cron (ex. `lm-refill-credits`) sont aussi écrites à la main dans la migration.
- Fonctions appelées par l'appli : `public.lm_member(account_id)` sur chaque identifiant, refus métier avec
  `hint`. Fonctions des robots : `revoke all from public` + `grant execute to service_role`.
- En-tête de chaque fonction : rôle, appelant (appli / robot / déclencheur), sécurité.
- **RLS des grosses tables** (prospects : 120 000 lignes pour une seule équipe) : jamais une fonction appelée par
  ligne. Écrire `account_id in (select public.lm_user_account_ids())` et `(select public.is_mfa_compliant())`
  (évalués une fois par requête). Sinon le tableau de bord dépasse le délai de 8 s (erreur 500 du 5/11/2026).
- Tout correctif de sécurité ou d'argent a son test pgTAP (voir `tests/database/leadmaker-audit-2026-11.test.sql`).

## Schema Organization

Schemas in `schemas/` directory with numbered prefixes for dependency ordering.

## Skills

For database implementation:
- `/postgres-expert` - Schema design, RLS, migrations, testing

After any change to RLS, grants, `SECURITY DEFINER` functions, views, or schema in
this directory, run the deep adversarial RLS review during verification:
- `/rls-review` - Statically audits tenant-isolation holes, then proves them (or
  their absence) with runnable pgTAP cross-tenant attack tests.

## Migration Workflow

### New Entities

Declarative schema first, then let `db:diff` write the migration — the same flow
as Modify Existing. Do not hand-copy the schema file into a migration: the two
then drift on exactly the details `db:diff` would have normalised.

```bash
# 1. Write the schema file (see Table Template)
touch schemas/20-feature.sql

# 2. Generate the migration from it, then clean it (see Reading a generated diff)
pnpm --filter web run supabase:db:diff -f feature_name

# 3. Apply and generate types
pnpm --filter web supabase migrations up
pnpm supabase:web:typegen

# 4. Prove the migration reproduces the schema file: this must report
#    nothing about your table
pnpm --filter web run supabase:db:diff
```

### Modify Existing

```bash
# Edit schema, generate diff
pnpm --filter web run supabase:db:diff -f update_feature

# Apply and regenerate
pnpm --filter web supabase migrations up
pnpm supabase:web:typegen
```

### Reading a generated diff

`supabase:db:diff` builds a shadow database from Supabase's defaults, so its
output is never purely your change. Before committing a generated migration:

- **Hand-write the `revoke` and the column grants.** For a new table migra
  emits the `create table`, constraints and whole-table grants, but never the
  per-table `revoke all ... from anon, authenticated, service_role` nor a
  `grant update (cols)`. Copy both from the schema file, after `create table`.
- **A `revoke ... from "anon"` on a table you did not touch is local drift.**
  The schema files revoke `anon`'s DML per table and
  `20260915094922_revoke_anon_dml.sql` brought the migrations in line, so a
  clean database produces none. Reset rather than committing them.
- **Re-run `supabase:db:diff` with no `-f` after applying.** A clean result
  mentions none of your tables. That is the check that the migration and the
  declarative schema actually agree — it catches the `unique`/`primary key`
  redundancy and similar silent drift. (Comments are not diffed, so omitted
  `comment on` statements do not show up here.)
- **Migrations must be non-destructive.** Customers run long-lived databases on
  every past migration. Alter in place (`create or replace function`, drop and
  re-add a constraint under the same name); never drop or rewrite a table.

### `migrations up` fails with `LegacyMigrationMissingLocalError`

The local database has a migration applied that is not in `migrations/` — usually
from a branch switch. It is drift in your local database, not in your change.
Reset rather than repairing:

```bash
pnpm supabase:web:reset   # re-applies every migration, then seeds
```

This wipes local data. Always reset before trusting a pgTAP run: local drift can
mask a missing grant that CI will then fail on.

## Security Rules

- **ALWAYS enable RLS** on new tables
- **NEVER use SECURITY DEFINER** without explicit access controls
- Use existing helper functions (see `/postgres-expert` skill)
- **Grant only the verbs the feature ships.** A grant is a live PostgREST
  capability the moment it lands, UI or not. Start at `select, insert`; add
  `update`/`delete` in the same change as the feature that needs it, gated on
  `public.has_permission(...)` the way `07-invitations.sql` and `16-storage.sql`
  do. Membership alone (`has_role_on_account`) is not an authorization check for
  destructive writes.
- **`created_by`/`updated_by` FKs to `auth.users` use `on delete set null`.**
  This applies to any row that can outlive the user, the tenant root `accounts`
  included. With the default NO ACTION, deleting any user who ever touched such
  a row fails — for them via account deletion and for admins via the
  delete-user action. Ownership transfer is the common way a row ends up
  referencing a user who is no longer its owner. `user-deletion-tracking.test.sql`
  covers it; extend that test when adding a table with tracking columns.
- **NEVER grant table-level `UPDATE` to `authenticated`.** Grant column-level
  UPDATE listing only the user-editable columns. Identity/tenancy columns
  (`id`, `account_id`, and any FK that defines ownership) must be excluded so a
  user cannot re-parent a row into another account via
  `UPDATE ... SET account_id = <other tenant>`. RLS `WITH CHECK` alone does not
  cover this cleanly; column privileges reject it up front.
  - Column privileges are checked only against the statement's `SET` list, so
    `BEFORE` triggers that write `updated_at`/tracking/system columns keep
    working even though `authenticated` lacks UPDATE on them. The tracking
    trigger additionally re-asserts `created_by` on every ordinary UPDATE, and
    steps aside only for the `set null` cascade from `auth.users`, so
    `created_by` stays immutable even on a table that grants more than it should.
  - `service_role` keeps full-table UPDATE for system-managed columns.
- **Revoke from all three roles, `anon` included.** Supabase's defaults grant
  `REFERENCES`, `TRIGGER`, `TRUNCATE` and (PG17+) `MAINTAIN` on every new table
  to `anon`, `authenticated` and `service_role` — before you grant anything and
  with RLS on. `TRUNCATE` bypasses RLS.
  `20260811000000_revoke_residual_privileges.sql` strips these defaults, but
  keep the per-table `revoke` as the readable, local guarantee.
  - Invisible to normal testing — `SELECT` is denied while `TRUNCATE` succeeds.
    Assert it in pgTAP; see `privileges.test.sql` and `/rls-review`.
  - Do not assume `service_role`'s DML makes its `TRUNCATE` redundant. On an
    RPC-only table (`nonces`) it holds no DML at all, so `TRUNCATE` would be the
    only write it could perform.
  - `REVOKE ... ON ALL TABLES IN SCHEMA` only covers tables that already exist,
    so it never substitutes for a per-table `revoke`.
  - The stripped defaults cover objects created by `postgres` (migrations,
    dashboard, pg_meta). Supabase's `supabase_admin` defaults still grant full
    `arwdDxtm` and `postgres` cannot alter them on hosted, so extension-created
    tables in `public` need their own explicit revoke.
- **Prefer `generated always as identity` over `serial`/`bigserial`.** Identity
  columns need no privilege on their sequence, so there is no sequence ACL to
  get wrong. A `serial` column needs `usage` on its sequence for `nextval()`,
  which you must now grant explicitly alongside the table grants:
  `grant usage on sequence public.feature_id_seq to authenticated;`
  - Never grant `update` on a sequence to an API role — it permits `setval()`,
    which can rewind a counter into primary-key collisions. `usage` does not.

## Table Template

The whole canonical tenant-child table. Copy it rather than `03-accounts.sql`:
`accounts` is the tenant *root*, so its `id` doubles as a user id, its policies
key on `primary_owner_user_id`, and it carries a redundant `unique` on `id`.

```sql
create table if not exists public.feature (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  name varchar(255) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- `set null`, never the default NO ACTION: the row belongs to the account and
  -- outlives whoever created it, so it must not block deleting that user
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint feature_name_not_blank check (length(trim(name)) > 0)
);

alter table "public"."feature" enable row level security;

-- anon belongs here: Supabase's defaults grant it TRUNCATE, which bypasses RLS
revoke all on public.feature from anon, authenticated, service_role;

-- service_role keeps full-table access (system-managed columns included)
grant select, insert, update, delete on table public.feature to service_role;

-- authenticated gets ONLY the verbs the feature ships today. See "Grant only
-- the verbs the feature ships" before adding update or delete here.
grant select, insert on table public.feature to authenticated;

create trigger feature_set_timestamps
  before insert or update on public.feature
  for each row execute function public.trigger_set_timestamps();

create trigger feature_set_user_tracking
  before insert or update on public.feature
  for each row execute function public.trigger_set_user_tracking();

-- Index the tenancy FK in the order the feature actually reads
create index if not exists ix_feature_account_id_created_at
  on public.feature (account_id, created_at desc);

-- Team-only: has_role_on_account() is false for personal accounts (see the root
-- AGENTS.md). For personal accounts too, use
-- `account_id = (select auth.uid()) or public.has_role_on_account(account_id)`.
create policy "feature_read" on public.feature for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "feature_insert" on public.feature for insert
  to authenticated with check (public.has_role_on_account(account_id));

-- Mirror 13-mfa.sql: without this, an unelevated session belonging to a user
-- with MFA enabled can still reach the table
create policy "restrict_mfa_feature" on public.feature
  as restrictive to authenticated using (public.is_mfa_compliant());
```

Do not add `unique` to `id` alongside `primary key (id)`. It is redundant, and
`migra` does not emit the extra constraint, so the migration silently drifts from
the schema file.

## Commands

```bash
pnpm supabase:web:reset     # Reset database
pnpm supabase:web:test      # Run the pgTAP suite (reset first, see above)
pnpm supabase:web:typegen   # Generate TypeScript types
pnpm --filter web supabase migrations list  # View migrations
```
