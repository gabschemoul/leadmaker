/*
 * -------------------------------------------------------
 * Section: LeadMaker plans, quotas and credits
 * Les forfaits (Growth, Business, Scale) portent les quotas. L'organisation
 * (compte d'équipe MakerKit) porte ses crédits ; chaque débit est journalisé.
 * -------------------------------------------------------
 */

-- Catalogue des forfaits
create table if not exists public.lm_plans (
  id text not null,
  name text not null,
  seats integer,                      -- null = illimité
  spaces integer not null,
  discovery_credits integer not null, -- par mois
  outreach_credits integer not null,  -- par mois
  daily_send_limit integer not null,
  active_campaigns integer,           -- null = illimité
  auto_validation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  constraint lm_plans_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.lm_plans is 'Forfaits LeadMaker et quotas associés';

alter table public.lm_plans enable row level security;

revoke all on public.lm_plans from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_plans to service_role;

grant select on table public.lm_plans to authenticated;

create trigger lm_plans_set_timestamps
  before insert or update on public.lm_plans
  for each row execute function public.trigger_set_timestamps();

create policy "lm_plans_read" on public.lm_plans for select
  to authenticated using (true);

-- Correspondance prix Stripe -> forfait
create table if not exists public.lm_plan_variants (
  variant_id text not null,
  plan_id text references public.lm_plans(id) on delete cascade not null,
  interval text not null,
  primary key (variant_id),
  constraint lm_plan_variants_interval check (interval in ('month', 'year'))
);

comment on table public.lm_plan_variants is 'Identifiants de prix du fournisseur de paiement, rattachés à un forfait';

alter table public.lm_plan_variants enable row level security;

revoke all on public.lm_plan_variants from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_plan_variants to service_role;

grant select on table public.lm_plan_variants to authenticated;

create policy "lm_plan_variants_read" on public.lm_plan_variants for select
  to authenticated using (true);

-- Crédits et forfait courant d'une organisation
create table if not exists public.lm_account_credits (
  account_id uuid references public.accounts(id) on delete cascade not null,
  plan_id text references public.lm_plans(id) on delete set null,
  discovery_balance integer not null default 0,
  outreach_balance integer not null default 0,
  period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id),
  constraint lm_account_credits_non_negative check (discovery_balance >= 0 and outreach_balance >= 0)
);

comment on table public.lm_account_credits is 'Solde de crédits découverte et outreach par organisation';

alter table public.lm_account_credits enable row level security;

revoke all on public.lm_account_credits from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_account_credits to service_role;

grant select on table public.lm_account_credits to authenticated;

create trigger lm_account_credits_set_timestamps
  before insert or update on public.lm_account_credits
  for each row execute function public.trigger_set_timestamps();

create policy "lm_account_credits_read" on public.lm_account_credits for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_account_credits" on public.lm_account_credits
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Journal des mouvements de crédits (Consommation)
create table if not exists public.lm_credit_ledger (
  id bigint generated always as identity,
  account_id uuid references public.accounts(id) on delete cascade not null,
  kind public.lm_credit_kind not null,
  delta integer not null,
  reason text not null,
  campaign_id uuid,
  event_ref text not null,
  created_at timestamptz not null default now(),
  primary key (id),
  constraint lm_credit_ledger_delta_not_zero check (delta <> 0),
  constraint lm_credit_ledger_event_ref_unique unique (event_ref)
);

comment on table public.lm_credit_ledger is 'Chaque débit ou recharge de crédits, idempotent par event_ref';

alter table public.lm_credit_ledger enable row level security;

revoke all on public.lm_credit_ledger from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_credit_ledger to service_role;

grant select on table public.lm_credit_ledger to authenticated;

create index if not exists ix_lm_credit_ledger_account_id_created_at
  on public.lm_credit_ledger (account_id, created_at desc);

create policy "lm_credit_ledger_read" on public.lm_credit_ledger for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_credit_ledger" on public.lm_credit_ledger
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Débit atomique et idempotent. Renvoie false si solde insuffisant ou événement déjà débité.
create or replace function public.lm_debit_credits(
  p_account_id uuid,
  p_kind public.lm_credit_kind,
  p_quantity integer,
  p_event_ref text,
  p_reason text,
  p_campaign_id uuid default null
) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_balance integer;
begin
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  if exists (select 1 from public.lm_credit_ledger where event_ref = p_event_ref) then
    return false;
  end if;

  if p_kind = 'discovery' then
    select discovery_balance into v_balance from public.lm_account_credits
      where account_id = p_account_id for update;
  else
    select outreach_balance into v_balance from public.lm_account_credits
      where account_id = p_account_id for update;
  end if;

  if v_balance is null or v_balance < p_quantity then
    return false;
  end if;

  if p_kind = 'discovery' then
    update public.lm_account_credits set discovery_balance = discovery_balance - p_quantity
      where account_id = p_account_id;
  else
    update public.lm_account_credits set outreach_balance = outreach_balance - p_quantity
      where account_id = p_account_id;
  end if;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, campaign_id, event_ref)
    values (p_account_id, p_kind, -p_quantity, p_reason, p_campaign_id, p_event_ref);

  return true;
end;
$$;

revoke all on function public.lm_debit_credits(uuid, public.lm_credit_kind, integer, text, text, uuid) from public;

grant execute on function public.lm_debit_credits(uuid, public.lm_credit_kind, integer, text, text, uuid) to service_role;

-- Recharge au renouvellement : remet les soldes aux valeurs du forfait.
create or replace function public.lm_reset_credits(
  p_account_id uuid,
  p_plan_id text,
  p_period_ends_at timestamptz,
  p_event_ref text
) returns void
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_plan public.lm_plans%rowtype;
begin
  select * into v_plan from public.lm_plans where id = p_plan_id;

  if v_plan.id is null then
    raise exception 'unknown plan %', p_plan_id;
  end if;

  if exists (select 1 from public.lm_credit_ledger where event_ref = p_event_ref || ':discovery') then
    return;
  end if;

  insert into public.lm_account_credits (account_id, plan_id, discovery_balance, outreach_balance, period_ends_at)
    values (p_account_id, p_plan_id, v_plan.discovery_credits, v_plan.outreach_credits, p_period_ends_at)
  on conflict (account_id) do update set
    plan_id = excluded.plan_id,
    discovery_balance = excluded.discovery_balance,
    outreach_balance = excluded.outreach_balance,
    period_ends_at = excluded.period_ends_at;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    values (p_account_id, 'discovery', v_plan.discovery_credits, 'renewal', p_event_ref || ':discovery'),
           (p_account_id, 'outreach', v_plan.outreach_credits, 'renewal', p_event_ref || ':outreach');
end;
$$;

revoke all on function public.lm_reset_credits(uuid, text, timestamptz, text) from public;

grant execute on function public.lm_reset_credits(uuid, text, timestamptz, text) to service_role;

-- Quota de sièges : limite du forfait courant (illimité sans forfait).
create or replace function public.lm_seat_limit(p_account_id uuid) returns integer
set search_path = ''
language sql
stable
security definer
as $$
  -- Sans forfait, aucune limite : un compte sans abonnement n'a pas de crédits, donc inviter ne donne rien.
  select coalesce(p.seats, 2147483647)
  from public.lm_account_credits c
  left join public.lm_plans p on p.id = c.plan_id
  where c.account_id = p_account_id
  union all
  select 2147483647
  where not exists (select 1 from public.lm_account_credits where account_id = p_account_id)
  limit 1;
$$;

grant execute on function public.lm_seat_limit(uuid) to authenticated, service_role;

create or replace function public.lm_enforce_seat_quota() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.accounts_memberships where account_id = new.account_id;

  if v_count >= public.lm_seat_limit(new.account_id) then
    raise exception 'seat quota reached for account %', new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger lm_accounts_memberships_seat_quota
  before insert on public.accounts_memberships
  for each row execute function public.lm_enforce_seat_quota();

-- Abonnement supprimé (résiliation effective) : l'organisation perd son forfait et ses crédits.
create or replace function public.lm_on_subscription_deleted() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  update public.lm_account_credits
     set plan_id = null, discovery_balance = 0, outreach_balance = 0, period_ends_at = null
   where account_id = old.account_id;

  return old;
end;
$$;

revoke all on function public.lm_on_subscription_deleted() from public;

create trigger lm_subscriptions_after_delete
  after delete on public.subscriptions
  for each row execute function public.lm_on_subscription_deleted();
