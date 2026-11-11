/*
 * -------------------------------------------------------
 * Section: LeadMaker packs de crédits (roadmap n°5, prix validés par Gabriel le 10/11/2026)
 * S = 3 000 crédits (99 $), M = 9 000 (279 $), L = 18 000 (549 $). Achat unique via Stripe (commande MakerKit),
 * réservé aux abonnés. Crédits valables 12 mois ; on consomme d'abord ceux du forfait (lm_debit_credits), puis ceux
 * des packs, le plus proche de son expiration d'abord.
 * -------------------------------------------------------
 */

create table if not exists public.lm_credit_packs (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- identifiant du pack (billing.config.ts : pack-s, pack-m, pack-l)
  pack_id text not null,
  credits integer not null,
  remaining integer not null,
  purchased_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 months'),
  -- commande Stripe (MakerKit orders.id) : un pack par commande, même si le webhook arrive deux fois
  order_ref text not null,
  primary key (id),
  constraint lm_credit_packs_order_ref unique (order_ref),
  constraint lm_credit_packs_credits_positive check (credits > 0),
  constraint lm_credit_packs_remaining check (remaining >= 0 and remaining <= credits)
);

comment on table public.lm_credit_packs is 'Packs de crédits achetés (valables 12 mois, consommés après les crédits du forfait)';

alter table public.lm_credit_packs enable row level security;

revoke all on public.lm_credit_packs from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_credit_packs to service_role;

grant select on table public.lm_credit_packs to authenticated;

create index if not exists ix_lm_credit_packs_account_id_expires_at on public.lm_credit_packs (account_id, expires_at);

create policy "lm_credit_packs_read" on public.lm_credit_packs for select
  to authenticated using (account_id in (select public.lm_user_account_ids()));

create policy "restrict_mfa_lm_credit_packs" on public.lm_credit_packs
  as restrictive to authenticated using ((select public.is_mfa_compliant()));

-- Crédits de packs encore utilisables (non expirés).
-- Appelant : fonctions de crédits (sécurité définie), lm_available_credits.
create or replace function public.lm_pack_credits(p_account_id uuid) returns integer
set search_path = ''
language sql
stable
security definer
as $$
  select coalesce(sum(p.remaining), 0)::integer from public.lm_credit_packs p
   where p.account_id = p_account_id and p.remaining > 0 and p.expires_at > now();
$$;

revoke all on function public.lm_pack_credits(uuid) from public, anon, authenticated;

grant execute on function public.lm_pack_credits(uuid) to service_role;

-- Crédits disponibles d'une organisation : forfait + packs non expirés (null pour un non-membre).
-- Appelant : appli (contrôle lm_member) et robots (rôle service). Les fonctions SQL internes additionnent
-- directement discovery_balance et lm_pack_credits.
create or replace function public.lm_available_credits(p_account_id uuid) returns integer
set search_path = ''
language sql
stable
security definer
as $$
  select case when (select auth.role()) = 'service_role' or current_setting('role', true) = 'service_role'
                or public.lm_member(p_account_id)
              then coalesce((select c.discovery_balance from public.lm_account_credits c where c.account_id = p_account_id), 0)
                   + public.lm_pack_credits(p_account_id)
         end;
$$;

revoke all on function public.lm_available_credits(uuid) from public, anon;

grant execute on function public.lm_available_credits(uuid) to authenticated, service_role;

-- Achat d'un pack (webhook Stripe, commande payée) : crédits ajoutés une seule fois par commande, noté au journal.
-- Renvoie vrai si le pack vient d'être ajouté, faux s'il l'était déjà.
-- Appelant : serveur (webhook), rôle service.
create or replace function public.lm_grant_credit_pack(p_account_id uuid, p_pack_id text, p_credits integer,
                                                       p_order_ref text) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
begin
  if p_credits is null or p_credits <= 0 or nullif(trim(p_order_ref), '') is null then
    raise exception 'invalid pack' using errcode = 'P0001';
  end if;

  insert into public.lm_credit_packs (account_id, pack_id, credits, remaining, order_ref)
  values (p_account_id, p_pack_id, p_credits, p_credits, p_order_ref)
  on conflict (order_ref) do nothing;

  if not found then
    return false;
  end if;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
  values (p_account_id, 'discovery', p_credits, 'pack', 'pack:' || p_order_ref)
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.lm_grant_credit_pack(uuid, text, integer, text) from public, anon, authenticated;

grant execute on function public.lm_grant_credit_pack(uuid, text, integer, text) to service_role;

-- Paiement des entreprises gardées restées en attente de crédits, dans toutes les campagnes (non archivées, prix
-- fixé) d'une organisation. Sans ça, une gardée arrivée pendant une panne de crédits n'était jamais réglée, donc
-- jamais contactée, même après une recharge (analyse UX S-02, 11/11/2026). Renvoie le nombre de gardées réglées.
-- Appelant : déclencheurs (recharge du forfait, achat d'un pack) ; robots / serveur uniquement (rôle service).
create or replace function public.lm_settle_account_kept(p_account_id uuid) returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_campaign uuid;
  v_count integer := 0;
begin
  for v_campaign in
    select c.id
      from public.lm_campaigns c
     where c.account_id = p_account_id and c.status <> 'archived'
       and nullif(trim(c.sort_target), '') is not null
       and exists (select 1 from public.lm_campaign_prospects cp
                    where cp.campaign_id = c.id and cp.paid_at is null
                      and coalesce(cp.client_choice, cp.verdict) = 'gardee')
     order by c.created_at
  loop
    v_count := v_count + public.lm_settle_kept(v_campaign, null);

    -- crédits de nouveau épuisés : inutile d'essayer les campagnes suivantes (somme écrite ici :
    -- lm_available_credits renvoie null hors d'une session membre ou service, par exemple sous pg_cron)
    exit when coalesce((select ac.discovery_balance from public.lm_account_credits ac where ac.account_id = p_account_id), 0)
              + public.lm_pack_credits(p_account_id) <= 0;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.lm_settle_account_kept(uuid) from public, anon, authenticated;

grant execute on function public.lm_settle_account_kept(uuid) to service_role;

-- Crédits ajoutés (forfait renouvelé ou rechargé, pack acheté) : les gardées en attente sont réglées tout de suite.
-- Jamais bloquant : ces écritures viennent du paiement Stripe ou de la recharge mensuelle ; si le règlement
-- échoue, il est annulé seul (bloc d'exception) et les crédits restent acquis.
-- Appelant : déclencheurs (trigger) sur lm_account_credits et lm_credit_packs.
create or replace function public.lm_credits_added_settle() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  begin
    perform public.lm_settle_account_kept(new.account_id);
  exception when others then
    raise warning 'lm_credits_added_settle %: %', new.account_id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.lm_credits_added_settle() from public, anon, authenticated;

-- seulement quand le solde monte (un débit le fait baisser : jamais de boucle débit → règlement → débit)
create or replace trigger lm_account_credits_added_settle
  after update of discovery_balance on public.lm_account_credits
  for each row
  when (new.discovery_balance > old.discovery_balance)
  execute function public.lm_credits_added_settle();

create or replace trigger lm_account_credits_created_settle
  after insert on public.lm_account_credits
  for each row
  when (new.discovery_balance > 0)
  execute function public.lm_credits_added_settle();

create or replace trigger lm_credit_packs_added_settle
  after insert on public.lm_credit_packs
  for each row
  execute function public.lm_credits_added_settle();

-- Argent d'une campagne, montré dans le parcours (analyse UX E-01 / T-03, 11/11/2026) : crédits déjà utilisés par
-- la campagne, crédits disponibles de l'organisation (forfait + packs). Le prix d'une gardée vient de
-- lm_campaign_sort_summary. Rien pour un non-membre.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_campaign_money(p_campaign_id uuid)
returns table (spent integer, available integer)
set search_path = ''
language sql
stable
security definer
as $$
  select (select coalesce(sum(cp.credits), 0)::integer from public.lm_campaign_prospects cp
           where cp.campaign_id = c.id),
         coalesce((select ac.discovery_balance from public.lm_account_credits ac where ac.account_id = c.account_id), 0)
           + public.lm_pack_credits(c.account_id)
    from public.lm_campaigns c
   where c.id = p_campaign_id and public.lm_member(c.account_id);
$$;

revoke all on function public.lm_campaign_money(uuid) from public, anon;

grant execute on function public.lm_campaign_money(uuid) to authenticated, service_role;
