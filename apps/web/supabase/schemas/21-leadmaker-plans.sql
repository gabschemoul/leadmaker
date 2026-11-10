/*
 * -------------------------------------------------------
 * Section: LeadMaker plans, quotas and credits
 * Les forfaits (Growth, Business, Scale) portent les quotas. L'organisation
 * (compte d'équipe MakerKit) porte ses crédits ; chaque débit est journalisé.
 * -------------------------------------------------------
 */

-- Organisations dont l'utilisateur connecté est membre. Utilisée par la RLS des grosses tables (prospects,
-- tentatives, journal des crédits, tâches, recherches) sous la forme `account_id in (select …)` : évaluée UNE
-- fois par requête au lieu d'un appel à has_role_on_account par ligne (5/11/2026 : le tableau de bord d'une
-- équipe à 120 000 prospects dépassait le délai de 8 s de la base).
-- Appelant : politiques RLS (utilisateur connecté).
create or replace function public.lm_user_account_ids() returns setof uuid
set search_path = ''
language sql
stable
security definer
as $$
  select m.account_id from public.accounts_memberships m where m.user_id = (select auth.uid());
$$;

revoke all on function public.lm_user_account_ids() from public;

grant execute on function public.lm_user_account_ids() to authenticated, service_role;

-- Catalogue des forfaits
create table if not exists public.lm_plans (
  id text not null,
  name text not null,
  seats integer,                      -- null = illimité
  spaces integer not null,
  discovery_credits integer not null, -- par mois
  outreach_credits integer not null,  -- par mois
  active_campaigns integer,           -- null = illimité
  auto_validation boolean not null default false,
  -- Roadmap n°14 : budget de proxy par mois (Go), invisible pour le client. Au-delà, sa recherche ralentit
  -- (une seule recherche à la fois pour tout le compte) au lieu de coûter plus. null = pas de plafond.
  proxy_gb_month integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  constraint lm_plans_name_not_blank check (length(trim(name)) > 0),
  constraint lm_plans_proxy_gb_month check (proxy_gb_month is null or proxy_gb_month > 0)
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
  -- Trafic proxy (octets) consommé par les recherches et estimations du compte depuis la dernière recharge
  -- (roadmap n°14) ; alimenté par lm_add_search_bytes, remis à zéro par lm_reset_credits
  proxy_bytes_period bigint not null default 0,
  -- Forfaits annuels : prochaine recharge mensuelle des crédits (lm_refill_credits, tâche planifiée).
  -- null pour les forfaits mensuels, rechargés par le webhook Stripe à chaque renouvellement.
  next_refill_at timestamptz,
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

-- Débits d'une campagne (avancement : prospects trouvés) sans parcourir tout le registre
create index if not exists ix_lm_credit_ledger_campaign_id
  on public.lm_credit_ledger (campaign_id) where campaign_id is not null;

create policy "lm_credit_ledger_read" on public.lm_credit_ledger for select
  to authenticated using (account_id in (select public.lm_user_account_ids()));

create policy "restrict_mfa_lm_credit_ledger" on public.lm_credit_ledger
  as restrictive to authenticated using ((select public.is_mfa_compliant()));

-- Membre de l'organisation ET double authentification respectée (audit 5/11/2026, A6).
-- À utiliser dans TOUTES les fonctions SECURITY DEFINER appelées par l'appli : elles contournent la RLS, donc
-- les politiques restrictives « restrict_mfa_* » ne s'y appliquent pas. Faux pour le rôle service (robots).
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_member(p_account_id uuid) returns boolean
set search_path = ''
language sql
stable
as $$
  select public.has_role_on_account(p_account_id) and coalesce(public.is_mfa_compliant(), false);
$$;

grant execute on function public.lm_member(uuid) to authenticated, service_role;

-- L'organisation a-t-elle un forfait (ou des crédits offerts) ? Exigé pour tout ce qui fait travailler les
-- robots : estimation au-delà du quota d'essai, préparation de formulaires, recherche d'e-mails (audit A9).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_has_plan(p_account_id uuid) returns boolean
set search_path = ''
language sql
stable
security definer
as $$
  select exists (select 1 from public.lm_account_credits c
                  where c.account_id = p_account_id
                    and (c.plan_id is not null or c.discovery_balance > 0 or c.outreach_balance > 0));
$$;

revoke all on function public.lm_has_plan(uuid) from public;

grant execute on function public.lm_has_plan(uuid) to service_role;

-- Débit atomique et idempotent. Renvoie false si solde insuffisant ou événement déjà débité.
-- Appelant : robots / serveur uniquement (rôle service).
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
  v_rest integer;
  v_take integer;
  v_pack record;
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

  -- Packs de crédits (10/11/2026) : utilisés seulement quand le forfait ne suffit plus
  if p_kind = 'discovery' and v_balance is not null and v_balance < p_quantity then
    perform 1 from public.lm_credit_packs p
     where p.account_id = p_account_id and p.remaining > 0 and p.expires_at > now()
       for update;

    if v_balance + public.lm_pack_credits(p_account_id) < p_quantity then
      return false;
    end if;
  elsif v_balance is null or v_balance < p_quantity then
    return false;
  end if;

  -- Deux appels simultanés avec le même event_ref : le second bute sur l'unicité du journal ; on annule
  -- alors son débit et on renvoie false, comme pour un événement déjà débité.
  begin
    insert into public.lm_credit_ledger (account_id, kind, delta, reason, campaign_id, event_ref)
      values (p_account_id, p_kind, -p_quantity, p_reason, p_campaign_id, p_event_ref);
  exception when unique_violation then
    return false;
  end;

  if p_kind = 'discovery' then
    -- d'abord les crédits du forfait, puis les packs, le plus proche de son expiration d'abord
    update public.lm_account_credits set discovery_balance = discovery_balance - least(v_balance, p_quantity)
      where account_id = p_account_id;

    v_rest := p_quantity - least(v_balance, p_quantity);

    for v_pack in
      select p.id, p.remaining from public.lm_credit_packs p
       where p.account_id = p_account_id and p.remaining > 0 and p.expires_at > now()
       order by p.expires_at, p.purchased_at
    loop
      exit when v_rest <= 0;
      v_take := least(v_pack.remaining, v_rest);
      update public.lm_credit_packs set remaining = remaining - v_take where id = v_pack.id;
      v_rest := v_rest - v_take;
    end loop;
  else
    update public.lm_account_credits set outreach_balance = outreach_balance - p_quantity
      where account_id = p_account_id;
  end if;

  return true;
end;
$$;

revoke all on function public.lm_debit_credits(uuid, public.lm_credit_kind, integer, text, text, uuid) from public;

grant execute on function public.lm_debit_credits(uuid, public.lm_credit_kind, integer, text, text, uuid) to service_role;

-- Recharge depuis le webhook Stripe (createPlanCreditsService.syncFromSubscription), idempotente par event_ref
-- (abonnement + début de période + forfait).
--  * Nouvelle période (ou premier abonnement) : soldes remis aux quotas du forfait, compteur proxy à zéro.
--  * Changement de forfait PENDANT la période (même fin de période) : on n'ajoute que la différence de quotas
--    à la hausse, on plafonne à la baisse ; le compteur proxy n'est pas remis à zéro (audit A11 : sans ça,
--    Growth → Business → Scale le même mois donnait 30 k + 80 k + 200 k crédits).
--  * Période de plus de 35 jours = forfait annuel : les crédits sont mensuels, la recharge des mois suivants
--    est faite par lm_refill_credits (audit A12).
-- Appelant : robots / serveur uniquement (rôle service).
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
  v_old public.lm_plans%rowtype;
  v_current public.lm_account_credits%rowtype;
  v_refill timestamptz;
  v_discovery integer;
  v_outreach integer;
begin
  select * into v_plan from public.lm_plans where id = p_plan_id;

  if v_plan.id is null then
    raise exception 'unknown plan %', p_plan_id;
  end if;

  -- (un changement de forfait sans mouvement de crédits ne laisse pas de trace : le rejouer ne change rien)
  if exists (select 1 from public.lm_credit_ledger
              where event_ref in (p_event_ref || ':discovery', p_event_ref || ':outreach')) then
    return;
  end if;

  select * into v_current from public.lm_account_credits where account_id = p_account_id for update;

  v_refill := case when p_period_ends_at > now() + interval '35 days' then now() + interval '1 month' end;

  if v_current.plan_id is not null and v_current.plan_id <> p_plan_id
     and v_current.period_ends_at is not distinct from p_period_ends_at then
    -- Changement de forfait en cours de période
    select * into v_old from public.lm_plans where id = v_current.plan_id;

    v_discovery := greatest(0, least(v_current.discovery_balance + greatest(0, v_plan.discovery_credits - v_old.discovery_credits),
                                     v_plan.discovery_credits));
    v_outreach := greatest(0, least(v_current.outreach_balance + greatest(0, v_plan.outreach_credits - v_old.outreach_credits),
                                    v_plan.outreach_credits));

    update public.lm_account_credits
       set plan_id = p_plan_id, discovery_balance = v_discovery, outreach_balance = v_outreach
     where account_id = p_account_id;

    insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    select p_account_id, x.kind, x.delta, 'plan_change', p_event_ref || ':' || x.kind::text
      from (values ('discovery'::public.lm_credit_kind, v_discovery - v_current.discovery_balance),
                   ('outreach'::public.lm_credit_kind, v_outreach - v_current.outreach_balance)) as x(kind, delta)
     where x.delta <> 0;

    return;
  end if;

  insert into public.lm_account_credits (account_id, plan_id, discovery_balance, outreach_balance, period_ends_at,
                                         proxy_bytes_period, next_refill_at)
    values (p_account_id, p_plan_id, v_plan.discovery_credits, v_plan.outreach_credits, p_period_ends_at, 0, v_refill)
  on conflict (account_id) do update set
    plan_id = excluded.plan_id,
    discovery_balance = excluded.discovery_balance,
    outreach_balance = excluded.outreach_balance,
    period_ends_at = excluded.period_ends_at,
    proxy_bytes_period = 0,
    next_refill_at = excluded.next_refill_at;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    values (p_account_id, 'discovery', v_plan.discovery_credits, 'renewal', p_event_ref || ':discovery'),
           (p_account_id, 'outreach', v_plan.outreach_credits, 'renewal', p_event_ref || ':outreach');
end;
$$;

revoke all on function public.lm_reset_credits(uuid, text, timestamptz, text) from public;

grant execute on function public.lm_reset_credits(uuid, text, timestamptz, text) to service_role;

-- Forfaits annuels : recharge mensuelle des crédits (audit A12). Appelée toutes les heures par pg_cron
-- (tâche « lm-refill-credits », créée dans la migration 20261105 de l'audit). Idempotente par mois.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_refill_credits() returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select c.account_id, c.next_refill_at, p.discovery_credits, p.outreach_credits
      from public.lm_account_credits c
      join public.lm_plans p on p.id = c.plan_id
     where c.next_refill_at is not null and c.next_refill_at <= now()
       and (c.period_ends_at is null or c.period_ends_at > now())
     for update of c skip locked
  loop
    update public.lm_account_credits
       set discovery_balance = r.discovery_credits, outreach_balance = r.outreach_credits, proxy_bytes_period = 0,
           next_refill_at = r.next_refill_at + interval '1 month'
     where account_id = r.account_id;

    insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    values (r.account_id, 'discovery', r.discovery_credits, 'monthly_refill',
            'refill:' || r.account_id::text || ':' || r.next_refill_at::text || ':discovery'),
           (r.account_id, 'outreach', r.outreach_credits, 'monthly_refill',
            'refill:' || r.account_id::text || ':' || r.next_refill_at::text || ':outreach')
    on conflict (event_ref) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.lm_refill_credits() from public;

grant execute on function public.lm_refill_credits() to service_role;

-- Budget de proxy du compte dépassé pour la période en cours (roadmap n°14) ? Faux sans forfait ou sans plafond.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_proxy_over_budget(p_account_id uuid) returns boolean
set search_path = ''
language sql
stable
security definer
as $$
  select coalesce(
    (select c.proxy_bytes_period >= p.proxy_gb_month::bigint * 1000000000
       from public.lm_account_credits c
       join public.lm_plans p on p.id = c.plan_id
      where c.account_id = p_account_id and p.proxy_gb_month is not null),
    false);
$$;

revoke all on function public.lm_proxy_over_budget(uuid) from public;

grant execute on function public.lm_proxy_over_budget(uuid) to service_role;

-- Quota de sièges : limite du forfait courant (illimité sans forfait).
-- Appelant : robots / serveur uniquement (rôle service).
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

revoke all on function public.lm_seat_limit(uuid) from public;

grant execute on function public.lm_seat_limit(uuid) to service_role;

-- Sièges encore libres pour inviter (audit E15) : limite du forfait − membres − invitations en attente.
-- Appelant : appli (fenêtre « Inviter des membres », règle d'invitation prospectigo-seat-limit), membres seulement.
-- null = pas de limite.
create or replace function public.lm_seats_available(p_account_id uuid) returns integer
set search_path = ''
language plpgsql
stable
security definer
as $$
declare
  v_limit integer;
begin
  if not public.lm_member(p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  v_limit := public.lm_seat_limit(p_account_id);

  if v_limit >= 2147483647 then
    return null;
  end if;

  return greatest(0, v_limit
    - (select count(*) from public.accounts_memberships m where m.account_id = p_account_id)::integer
    - (select count(*) from public.invitations i where i.account_id = p_account_id and i.expires_at > now())::integer);
end;
$$;

revoke all on function public.lm_seats_available(uuid) from public;

grant execute on function public.lm_seats_available(uuid) to authenticated, service_role;

-- Refuse un nouveau membre au-delà des sièges du forfait (à l'acceptation d'une invitation).
-- Appelant : déclencheur (trigger).
create or replace function public.lm_enforce_seat_quota() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  -- une arrivée à la fois par organisation : deux acceptations simultanées ne dépassent pas le quota (audit A14)
  perform pg_advisory_xact_lock(hashtext('lm_seat_quota:' || new.account_id::text));

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
-- Appelant : déclencheur (trigger).
create or replace function public.lm_on_subscription_deleted() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  update public.lm_account_credits
     set plan_id = null, discovery_balance = 0, outreach_balance = 0, period_ends_at = null, next_refill_at = null,
         proxy_bytes_period = 0
   where account_id = old.account_id;

  return old;
end;
$$;

revoke all on function public.lm_on_subscription_deleted() from public;

create trigger lm_subscriptions_after_delete
  after delete on public.subscriptions
  for each row execute function public.lm_on_subscription_deleted();
