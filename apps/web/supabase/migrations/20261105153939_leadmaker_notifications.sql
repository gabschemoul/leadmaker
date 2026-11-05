-- Les robots tournent pendant la migration : verrous des tables qui reçoivent un déclencheur pris d'un coup,
-- dans un ordre fixe (mode « share row exclusive » : les lectures continuent). Voir 20261105120031.
do $$
begin
  perform set_config('lock_timeout', '30s', true);

  lock table public.accounts, public.subscriptions, public.lm_account_credits, public.lm_campaigns,
             public.lm_attempts, public.lm_autopilots in share row exclusive mode;
end;
$$;


  create table "public"."lm_notification_preferences" (
    "user_id" uuid not null,
    "disabled_groups" text[] not null default '{}'::text[],
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_notification_preferences" enable row level security;


  create table "public"."lm_notifications" (
    "id" bigint generated always as identity not null,
    "kind" text not null,
    "account_id" uuid,
    "campaign_id" uuid,
    "payload" jsonb not null default '{}'::jsonb,
    "dedupe_key" text not null,
    "status" text not null default 'pending'::text,
    "attempts" integer not null default 0,
    "error" text,
    "claimed_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_notifications" enable row level security;

CREATE INDEX ix_lm_notifications_pending ON public.lm_notifications USING btree (created_at) WHERE (status = ANY (ARRAY['pending'::text, 'sending'::text]));

CREATE UNIQUE INDEX lm_notification_preferences_pkey ON public.lm_notification_preferences USING btree (user_id);

CREATE UNIQUE INDEX lm_notifications_dedupe_key_unique ON public.lm_notifications USING btree (dedupe_key);

CREATE UNIQUE INDEX lm_notifications_pkey ON public.lm_notifications USING btree (id);

alter table "public"."lm_notification_preferences" add constraint "lm_notification_preferences_pkey" PRIMARY KEY using index "lm_notification_preferences_pkey";

alter table "public"."lm_notifications" add constraint "lm_notifications_pkey" PRIMARY KEY using index "lm_notifications_pkey";

alter table "public"."lm_notification_preferences" add constraint "lm_notification_preferences_groups" CHECK ((disabled_groups <@ ARRAY['autopilot'::text, 'search'::text, 'credits'::text])) not valid;

alter table "public"."lm_notification_preferences" validate constraint "lm_notification_preferences_groups";

alter table "public"."lm_notification_preferences" add constraint "lm_notification_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."lm_notification_preferences" validate constraint "lm_notification_preferences_user_id_fkey";

alter table "public"."lm_notifications" add constraint "lm_notifications_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_notifications" validate constraint "lm_notifications_account_id_fkey";

alter table "public"."lm_notifications" add constraint "lm_notifications_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."lm_notifications" validate constraint "lm_notifications_campaign_id_fkey";

alter table "public"."lm_notifications" add constraint "lm_notifications_dedupe_key_unique" UNIQUE using index "lm_notifications_dedupe_key_unique";

alter table "public"."lm_notifications" add constraint "lm_notifications_status" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))) not valid;

alter table "public"."lm_notifications" validate constraint "lm_notifications_status";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_claim_notifications(p_limit integer DEFAULT 50)
 RETURNS TABLE(id bigint, kind text, account_id uuid, account_slug text, campaign_id uuid, campaign_name text, payload jsonb, created_at timestamp with time zone, recipients jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_notification(p_id bigint, p_ok boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.lm_notifications
     set status = case when p_ok then 'sent' else 'pending' end,
         sent_at = case when p_ok then now() end,
         error = case when p_ok then null else left(p_error, 500) end
   where id = p_id and status = 'sending';
$function$
;

CREATE OR REPLACE FUNCTION public.lm_notify(p_kind text, p_account_id uuid, p_campaign_id uuid, p_payload jsonb, p_dedupe_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.lm_notifications (kind, account_id, campaign_id, payload, dedupe_key)
  values (p_kind, p_account_id, p_campaign_id, coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning 'lm_notify % : %', p_kind, sqlerrm;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_notify_autopilot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.lm_notify_autopilot_preview()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.lm_notify_campaign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.lm_notify_credits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.lm_notify_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.is_personal_account then
    perform public.lm_notify('admin_signup', null, null,
      jsonb_build_object('email', new.email, 'name', new.name), 'admin_signup:' || new.id::text);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_notify_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

grant select on table "public"."lm_notification_preferences" to "authenticated";

grant delete on table "public"."lm_notification_preferences" to "service_role";

grant insert on table "public"."lm_notification_preferences" to "service_role";

grant select on table "public"."lm_notification_preferences" to "service_role";

grant update on table "public"."lm_notification_preferences" to "service_role";

grant delete on table "public"."lm_notifications" to "service_role";

grant insert on table "public"."lm_notifications" to "service_role";

grant select on table "public"."lm_notifications" to "service_role";

grant update on table "public"."lm_notifications" to "service_role";


  create policy "lm_notification_preferences_insert"
  on "public"."lm_notification_preferences"
  as permissive
  for insert
  to authenticated
with check ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "lm_notification_preferences_read"
  on "public"."lm_notification_preferences"
  as permissive
  for select
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "lm_notification_preferences_update"
  on "public"."lm_notification_preferences"
  as permissive
  for update
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check ((user_id = ( SELECT auth.uid() AS uid)));


CREATE TRIGGER lm_accounts_notify_signup AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.lm_notify_signup();

CREATE TRIGGER lm_account_credits_notify AFTER UPDATE OF discovery_balance, outreach_balance ON public.lm_account_credits FOR EACH ROW EXECUTE FUNCTION public.lm_notify_credits();

CREATE TRIGGER lm_attempts_notify_preview AFTER UPDATE OF status ON public.lm_attempts FOR EACH ROW EXECUTE FUNCTION public.lm_notify_autopilot_preview();

CREATE TRIGGER lm_autopilots_notify AFTER UPDATE OF status ON public.lm_autopilots FOR EACH ROW EXECUTE FUNCTION public.lm_notify_autopilot();

CREATE TRIGGER lm_campaigns_notify AFTER UPDATE OF status, filters ON public.lm_campaigns FOR EACH ROW EXECUTE FUNCTION public.lm_notify_campaign();

CREATE TRIGGER lm_subscriptions_notify AFTER INSERT OR UPDATE OF status, cancel_at_period_end ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.lm_notify_subscription();




-- Écrit à la main (db diff n'émet ni les revoke par table, ni les droits par colonne, ni les droits sur les fonctions)
revoke all on public.lm_notifications from anon, authenticated;
revoke all on public.lm_notification_preferences from anon;
revoke insert, update, delete on public.lm_notification_preferences from authenticated;
grant insert (user_id, disabled_groups), update (disabled_groups) on table public.lm_notification_preferences to authenticated;

revoke all on function public.lm_notify(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.lm_notify_autopilot() from public, anon, authenticated;
revoke all on function public.lm_notify_autopilot_preview() from public, anon, authenticated;
revoke all on function public.lm_notify_campaign() from public, anon, authenticated;
revoke all on function public.lm_notify_credits() from public, anon, authenticated;
revoke all on function public.lm_notify_signup() from public, anon, authenticated;
revoke all on function public.lm_notify_subscription() from public, anon, authenticated;
revoke all on function public.lm_claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.lm_claim_notifications(integer) to service_role;
revoke all on function public.lm_finish_notification(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.lm_finish_notification(bigint, boolean, text) to service_role;
