-- 3/11/2026 : recherche Google Maps d'une campagne sur un ordinateur dédié (sans proxy), réservée à des
-- utilisateurs précis. Nouvelles tables lm_local_discovery_users / lm_local_discovery_campaigns / lm_local_workers,
-- fonctions lm_claim_local_task, lm_local_discovery_state, lm_set_local_discovery.
-- Compatible avec le code en ligne : lm_claim_task garde la même signature et le même comportement tant
-- qu'aucune campagne n'est marquée (la seule différence : elle laisse de côté les recherches des campagnes marquées).
-- Les revoke des tables et les droits d'exécution des fonctions sont recopiés à la main (migra ne les écrit pas).

  create table "public"."lm_local_discovery_campaigns" (
    "campaign_id" uuid not null,
    "enabled_by" uuid,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_local_discovery_campaigns" enable row level security;

revoke all on public.lm_local_discovery_campaigns from anon, authenticated, service_role;


  create table "public"."lm_local_discovery_users" (
    "user_id" uuid not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_local_discovery_users" enable row level security;

revoke all on public.lm_local_discovery_users from anon, authenticated, service_role;


  create table "public"."lm_local_workers" (
    "worker_id" text not null,
    "seen_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_local_workers" enable row level security;

revoke all on public.lm_local_workers from anon, authenticated, service_role;

CREATE UNIQUE INDEX lm_local_discovery_campaigns_pkey ON public.lm_local_discovery_campaigns USING btree (campaign_id);

CREATE UNIQUE INDEX lm_local_discovery_users_pkey ON public.lm_local_discovery_users USING btree (user_id);

CREATE UNIQUE INDEX lm_local_workers_pkey ON public.lm_local_workers USING btree (worker_id);

alter table "public"."lm_local_discovery_campaigns" add constraint "lm_local_discovery_campaigns_pkey" PRIMARY KEY using index "lm_local_discovery_campaigns_pkey";

alter table "public"."lm_local_discovery_users" add constraint "lm_local_discovery_users_pkey" PRIMARY KEY using index "lm_local_discovery_users_pkey";

alter table "public"."lm_local_workers" add constraint "lm_local_workers_pkey" PRIMARY KEY using index "lm_local_workers_pkey";

alter table "public"."lm_local_discovery_campaigns" add constraint "lm_local_discovery_campaigns_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."lm_local_discovery_campaigns" validate constraint "lm_local_discovery_campaigns_campaign_id_fkey";

alter table "public"."lm_local_discovery_campaigns" add constraint "lm_local_discovery_campaigns_enabled_by_fkey" FOREIGN KEY (enabled_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_local_discovery_campaigns" validate constraint "lm_local_discovery_campaigns_enabled_by_fkey";

alter table "public"."lm_local_discovery_users" add constraint "lm_local_discovery_users_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."lm_local_discovery_users" validate constraint "lm_local_discovery_users_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_claim_local_task(p_worker_id text)
 RETURNS SETOF public.lm_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.lm_local_workers as w (worker_id, seen_at)
  values (p_worker_id, now())
  on conflict (worker_id) do update set seen_at = excluded.seen_at
   where w.seen_at < now() - interval '30 seconds';

  return query
  update public.lm_tasks t
     set status = 'running',
         worker_id = p_worker_id,
         locked_at = now(),
         attempts = t.attempts + 1
   where t.id = (
     select q.id from public.lm_tasks q
       join public.lm_local_discovery_campaigns l on l.campaign_id::text = q.payload ->> 'campaign_id'
      where q.status = 'queued' and q.kind = 'discovery' and q.run_after <= now()
      order by q.priority, q.created_at
      for update of q skip locked
      limit 1
   )
  returning t.*;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_local_discovery_state(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_last_seen timestamptz;
begin
  select account_id into v_account_id from public.lm_campaigns where id = p_campaign_id;

  if v_account_id is null or not public.has_role_on_account(v_account_id) then
    return null;
  end if;

  select greatest(
           (select max(seen_at) from public.lm_local_workers),
           (select max(t.locked_at) from public.lm_tasks t
              join public.lm_local_discovery_campaigns l on l.campaign_id::text = t.payload ->> 'campaign_id'
             where t.kind = 'discovery' and t.status = 'running'))
    into v_last_seen;

  return jsonb_build_object(
    'allowed', exists (select 1 from public.lm_local_discovery_users where user_id = (select auth.uid())),
    'enabled', exists (select 1 from public.lm_local_discovery_campaigns where campaign_id = p_campaign_id),
    'last_seen', v_last_seen,
    'minutes_ago', floor(extract(epoch from now() - v_last_seen) / 60)::integer
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_set_local_discovery(p_campaign_id uuid, p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from public.lm_campaigns where id = p_campaign_id;

  if v_account_id is null or not public.has_role_on_account(v_account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.lm_local_discovery_users where user_id = (select auth.uid())) then
    raise exception 'local discovery not allowed' using errcode = '42501';
  end if;

  if p_enabled then
    insert into public.lm_local_discovery_campaigns (campaign_id, enabled_by)
    values (p_campaign_id, (select auth.uid()))
    on conflict (campaign_id) do nothing;
  else
    delete from public.lm_local_discovery_campaigns where campaign_id = p_campaign_id;
  end if;

  return p_enabled;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_claim_task(p_kinds public.lm_task_kind[], p_worker_id text)
 RETURNS SETOF public.lm_tasks
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.lm_tasks t
     set status = 'running',
         worker_id = p_worker_id,
         locked_at = now(),
         attempts = t.attempts + 1
   where t.id = (
     select q.id from public.lm_tasks q
      where q.status = 'queued' and q.kind = any (p_kinds) and q.run_after <= now()
        and not (q.kind = 'discovery' and exists (
              select 1 from public.lm_local_discovery_campaigns l
               where l.campaign_id::text = q.payload ->> 'campaign_id'))
      order by q.priority, q.created_at
      for update skip locked
      limit 1
   )
  returning t.*;
$function$
;

grant delete on table "public"."lm_local_discovery_campaigns" to "service_role";

grant insert on table "public"."lm_local_discovery_campaigns" to "service_role";

grant select on table "public"."lm_local_discovery_campaigns" to "service_role";

grant update on table "public"."lm_local_discovery_campaigns" to "service_role";

grant delete on table "public"."lm_local_discovery_users" to "service_role";

grant insert on table "public"."lm_local_discovery_users" to "service_role";

grant select on table "public"."lm_local_discovery_users" to "service_role";

grant update on table "public"."lm_local_discovery_users" to "service_role";

grant delete on table "public"."lm_local_workers" to "service_role";

grant insert on table "public"."lm_local_workers" to "service_role";

grant select on table "public"."lm_local_workers" to "service_role";

grant update on table "public"."lm_local_workers" to "service_role";

comment on table public.lm_local_discovery_users is 'Utilisateurs autorisés à faire chercher une campagne sur l''ordinateur dédié';

comment on table public.lm_local_discovery_campaigns is 'Campagnes cherchées sur l''ordinateur dédié (sans proxy)';

comment on table public.lm_local_workers is 'Dernier signe de vie des robots lancés sur un ordinateur dédié';

revoke all on function public.lm_claim_task(public.lm_task_kind[], text) from public;

grant execute on function public.lm_claim_task(public.lm_task_kind[], text) to service_role;

revoke all on function public.lm_claim_local_task(text) from public;

grant execute on function public.lm_claim_local_task(text) to service_role;

revoke all on function public.lm_local_discovery_state(uuid) from public;

grant execute on function public.lm_local_discovery_state(uuid) to authenticated;

revoke all on function public.lm_set_local_discovery(uuid, boolean) from public;

grant execute on function public.lm_set_local_discovery(uuid, boolean) to authenticated;

-- Utilisateurs autorisés au départ (décision de Gabriel du 3/11/2026) ; sans effet si les comptes n'existent pas
insert into public.lm_local_discovery_users (user_id)
select id from auth.users where email in ('schemoul.gabriel@gmail.com', 'nathanyelbns@gmail.com')
on conflict (user_id) do nothing;
