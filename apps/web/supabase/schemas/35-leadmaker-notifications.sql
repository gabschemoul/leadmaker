/*
 * -------------------------------------------------------
 * Section: LeadMaker notifications par e-mail (5/11/2026, demande de Nath)
 * Des déclencheurs posent un événement dans lm_notifications (une ligne par événement, dédoublonnée par
 * dedupe_key) ; toutes les 5 minutes, la route Next.js /api/notifications/dispatch (Vercel Cron) les réclame
 * avec lm_claim_notifications, envoie les e-mails (FR/EN selon la personne) et les clôt avec
 * lm_finish_notification. Chaque utilisateur peut couper un groupe de notifications
 * (lm_notification_preferences, page Paramètres de l'équipe).
 *
 * Événements (kind) :
 *  - clients : autopilot_preview_ready, autopilot_done, search_done, search_no_credits, credits_low ;
 *  - équipe Prospectigo (adresses ADMIN_NOTIFICATION_EMAILS côté Vercel) : admin_signup,
 *    admin_subscription_new, admin_subscription_canceled, admin_payment_failed.
 * -------------------------------------------------------
 */
create table if not exists public.lm_notifications (
  id bigint generated always as identity,
  kind text not null,
  account_id uuid references public.accounts(id) on delete cascade,
  campaign_id uuid references public.lm_campaigns(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (id),
  constraint lm_notifications_dedupe_key_unique unique (dedupe_key),
  constraint lm_notifications_status check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'))
);

comment on table public.lm_notifications is 'Notifications e-mail à envoyer (file lue par /api/notifications/dispatch)';

alter table public.lm_notifications enable row level security;

revoke all on public.lm_notifications from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_notifications to service_role;

create index if not exists ix_lm_notifications_pending
  on public.lm_notifications (created_at) where status in ('pending', 'sending');

-- Préférences : groupes de notifications coupés par l'utilisateur (autopilot, search, credits)
create table if not exists public.lm_notification_preferences (
  user_id uuid references auth.users on delete cascade not null,
  disabled_groups text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id),
  constraint lm_notification_preferences_groups check (disabled_groups <@ array['autopilot', 'search', 'credits'])
);

comment on table public.lm_notification_preferences is 'Groupes de notifications e-mail coupés par un utilisateur';

alter table public.lm_notification_preferences enable row level security;

revoke all on public.lm_notification_preferences from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_notification_preferences to service_role;

grant select on table public.lm_notification_preferences to authenticated;

grant insert (user_id, disabled_groups), update (disabled_groups) on table public.lm_notification_preferences to authenticated;

create policy "lm_notification_preferences_read" on public.lm_notification_preferences for select
  to authenticated using (user_id = (select auth.uid()));

create policy "lm_notification_preferences_insert" on public.lm_notification_preferences for insert
  to authenticated with check (user_id = (select auth.uid()));

create policy "lm_notification_preferences_update" on public.lm_notification_preferences for update
  to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Pose un événement (ignoré s'il existe déjà avec la même clé). Ne lève jamais d'erreur : une notification ne
-- doit pas faire échouer l'action qui l'a déclenchée (recherche, envoi, paiement…).
-- Appelant : interne (déclencheurs de cette section).
create or replace function public.lm_notify(p_kind text, p_account_id uuid, p_campaign_id uuid, p_payload jsonb,
                                            p_dedupe_key text) returns void
set search_path = ''
language plpgsql
security definer
as $$
begin
  insert into public.lm_notifications (kind, account_id, campaign_id, payload, dedupe_key)
  values (p_kind, p_account_id, p_campaign_id, coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning 'lm_notify % : %', p_kind, sqlerrm;
end;
$$;

revoke all on function public.lm_notify(text, uuid, uuid, jsonb, text) from public;

-- Pilote automatique terminé (nombre atteint ou plus personne à contacter)
-- Appelant : déclencheur (trigger).
create or replace function public.lm_notify_autopilot() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform public.lm_notify('autopilot_done', new.account_id, new.campaign_id,
      jsonb_build_object('reason', new.finished_reason, 'target', new.target,
                         'sent', (select count(*) from public.lm_attempts a
                                   where a.autopilot_id = new.id and a.status = 'sent')),
      'autopilot_done:' || new.id::text);
  end if;

  return new;
end;
$$;

revoke all on function public.lm_notify_autopilot() from public;

create trigger lm_autopilots_notify
  after update of status on public.lm_autopilots
  for each row execute function public.lm_notify_autopilot();

-- Aperçu du pilote : les premiers formulaires sont tous préparés, le client doit les vérifier
-- Appelant : déclencheur (trigger).
create or replace function public.lm_notify_autopilot_preview() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
declare
  ap record;
begin
  if new.autopilot_id is null or old.status not in ('pending', 'preparing')
     or new.status in ('pending', 'preparing') then
    return new;
  end if;

  select a.id, a.status, a.account_id, a.campaign_id into ap from public.lm_autopilots a where a.id = new.autopilot_id;

  if ap.status = 'preview' and not exists (
       select 1 from public.lm_attempts x
        where x.autopilot_id = ap.id and x.status in ('pending', 'preparing')) then
    perform public.lm_notify('autopilot_preview_ready', ap.account_id, ap.campaign_id,
      jsonb_build_object('count', (select count(*) from public.lm_attempts x where x.autopilot_id = ap.id)),
      'autopilot_preview:' || ap.id::text);
  end if;

  return new;
end;
$$;

revoke all on function public.lm_notify_autopilot_preview() from public;

create trigger lm_attempts_notify_preview
  after update of status on public.lm_attempts
  for each row execute function public.lm_notify_autopilot_preview();

-- Recherche terminée, ou arrêtée faute de crédits de prospection (au plus une fois par jour et par campagne)
-- Appelant : déclencheur (trigger).
create or replace function public.lm_notify_campaign() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.lm_notify('search_done', new.account_id, new.id,
      jsonb_build_object('prospects', (select count(*) from public.lm_prospects p where p.campaign_id = new.id)),
      'search_done:' || new.id::text || ':' || current_date::text);
  elsif new.status = 'paused' and new.filters ->> 'paused_reason' = 'no_credits'
        and not (old.status = 'paused' and old.filters ->> 'paused_reason' = 'no_credits') then
    perform public.lm_notify('search_no_credits', new.account_id, new.id,
      jsonb_build_object('prospects', (select count(*) from public.lm_prospects p where p.campaign_id = new.id)),
      'search_no_credits:' || new.id::text || ':' || current_date::text);
  end if;

  return new;
end;
$$;

revoke all on function public.lm_notify_campaign() from public;

create trigger lm_campaigns_notify
  after update of status, filters on public.lm_campaigns
  for each row execute function public.lm_notify_campaign();

-- Crédits : passage sous 20 % du quota du forfait (une fois par type et par période)
-- Appelant : déclencheur (trigger).
create or replace function public.lm_notify_credits() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_plan public.lm_plans%rowtype;
  v_period text := coalesce(new.period_ends_at::date::text, current_date::text);
begin
  if new.plan_id is null then
    return new;
  end if;

  select * into v_plan from public.lm_plans where id = new.plan_id;

  if new.discovery_balance < v_plan.discovery_credits * 0.2 and old.discovery_balance >= v_plan.discovery_credits * 0.2 then
    perform public.lm_notify('credits_low', new.account_id, null,
      jsonb_build_object('credit', 'discovery', 'remaining', new.discovery_balance, 'quota', v_plan.discovery_credits,
                         'renewal', coalesce(new.next_refill_at, new.period_ends_at)),
      'credits_low:discovery:' || new.account_id::text || ':' || v_period);
  end if;

  if new.outreach_balance < v_plan.outreach_credits * 0.2 and old.outreach_balance >= v_plan.outreach_credits * 0.2 then
    perform public.lm_notify('credits_low', new.account_id, null,
      jsonb_build_object('credit', 'outreach', 'remaining', new.outreach_balance, 'quota', v_plan.outreach_credits,
                         'renewal', coalesce(new.next_refill_at, new.period_ends_at)),
      'credits_low:outreach:' || new.account_id::text || ':' || v_period);
  end if;

  return new;
end;
$$;

revoke all on function public.lm_notify_credits() from public;

create trigger lm_account_credits_notify
  after update of discovery_balance, outreach_balance on public.lm_account_credits
  for each row execute function public.lm_notify_credits();

-- Équipe Prospectigo : nouvel inscrit (compte personnel créé à l'inscription)
-- Appelant : déclencheur (trigger).
create or replace function public.lm_notify_signup() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if new.is_personal_account then
    perform public.lm_notify('admin_signup', null, null,
      jsonb_build_object('email', new.email, 'name', new.name), 'admin_signup:' || new.id::text);
  end if;

  return new;
end;
$$;

revoke all on function public.lm_notify_signup() from public;

create trigger lm_accounts_notify_signup
  after insert on public.accounts
  for each row execute function public.lm_notify_signup();

-- Équipe Prospectigo : nouvel abonnement, résiliation demandée, paiement échoué
-- Appelant : déclencheur (trigger).
create or replace function public.lm_notify_subscription() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_team text;
  v_owner text;
begin
  select a.name, u.email into v_team, v_owner
    from public.accounts a left join auth.users u on u.id = a.primary_owner_user_id
   where a.id = new.account_id;

  if tg_op = 'INSERT' then
    perform public.lm_notify('admin_subscription_new', null, null,
      jsonb_build_object('team', v_team, 'owner', v_owner, 'status', new.status),
      'admin_subscription_new:' || new.id);
  elsif new.cancel_at_period_end and not old.cancel_at_period_end then
    perform public.lm_notify('admin_subscription_canceled', null, null,
      jsonb_build_object('team', v_team, 'owner', v_owner, 'ends_at', new.period_ends_at),
      'admin_subscription_canceled:' || new.id || ':' || current_date::text);
  elsif new.status in ('past_due', 'unpaid') and old.status is distinct from new.status then
    perform public.lm_notify('admin_payment_failed', null, null,
      jsonb_build_object('team', v_team, 'owner', v_owner, 'status', new.status),
      'admin_payment_failed:' || new.id || ':' || current_date::text);
  end if;

  return new;
end;
$$;

revoke all on function public.lm_notify_subscription() from public;

create trigger lm_subscriptions_notify
  after insert or update of status, cancel_at_period_end on public.subscriptions
  for each row execute function public.lm_notify_subscription();

-- Réclame les notifications à envoyer (au plus p_limit), avec leurs destinataires : membres de l'organisation
-- qui n'ont pas coupé ce groupe (langue = user_metadata.lang, sinon fr) ; vide pour les événements admin.
-- Une notification réclamée il y a plus de 10 min sans être close est reprise (au plus 3 essais).
-- Appelant : robots / serveur uniquement (rôle service) — route /api/notifications/dispatch.
create or replace function public.lm_claim_notifications(p_limit integer default 50)
returns table (id bigint, kind text, account_id uuid, account_slug text, campaign_id uuid, campaign_name text,
               payload jsonb, created_at timestamptz, recipients jsonb)
set search_path = ''
language plpgsql
security definer
as $$
#variable_conflict use_column
begin
  -- trop vieilles (plus de 2 jours) ou trop d'essais : abandonnées
  update public.lm_notifications n set status = 'skipped', error = coalesce(n.error, 'expirée')
   where n.status in ('pending', 'sending')
     and (n.created_at < now() - interval '2 days' or n.attempts >= 3);

  return query
  with claimed as (
    update public.lm_notifications n
       set status = 'sending', claimed_at = now(), attempts = n.attempts + 1
     where n.id in (select x.id from public.lm_notifications x
                     where x.status = 'pending'
                        or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes')
                     order by x.created_at
                     limit greatest(1, least(coalesce(p_limit, 50), 200))
                       for update skip locked)
    returning n.*
  )
  select c.id, c.kind, c.account_id, a.slug::text, c.campaign_id, camp.name::text, c.payload, c.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('email', u.email,
                                               'language', coalesce(u.raw_user_meta_data ->> 'lang', 'fr')))
             from public.accounts_memberships m
             join auth.users u on u.id = m.user_id
             left join public.lm_notification_preferences pref on pref.user_id = m.user_id
            where m.account_id = c.account_id and u.email is not null
              and not (case
                         when c.kind like 'autopilot%' then 'autopilot'
                         when c.kind like 'search%' then 'search'
                         when c.kind like 'credits%' then 'credits'
                       end = any (coalesce(pref.disabled_groups, '{}'::text[])))), '[]'::jsonb)
    from claimed c
    left join public.accounts a on a.id = c.account_id
    left join public.lm_campaigns camp on camp.id = c.campaign_id;
end;
$$;

revoke all on function public.lm_claim_notifications(integer) from public;

grant execute on function public.lm_claim_notifications(integer) to service_role;

-- Clôt une notification réclamée (envoyée, ou en échec : elle sera retentée au plus 3 fois)
-- Appelant : robots / serveur uniquement (rôle service) — route /api/notifications/dispatch.
create or replace function public.lm_finish_notification(p_id bigint, p_ok boolean, p_error text default null)
returns void
set search_path = ''
language sql
security definer
as $$
  update public.lm_notifications
     set status = case when p_ok then 'sent' else 'pending' end,
         sent_at = case when p_ok then now() end,
         error = case when p_ok then null else left(p_error, 500) end
   where id = p_id and status = 'sending';
$$;

revoke all on function public.lm_finish_notification(bigint, boolean, text) from public;

grant execute on function public.lm_finish_notification(bigint, boolean, text) to service_role;
