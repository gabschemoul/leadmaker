/*
 * -------------------------------------------------------
 * Section: LeadMaker — recherche Google Maps sur un ordinateur dédié (décidé le 3/11/2026)
 * Une campagne marquée ici voit ses recherches Google Maps faites par un robot lancé sur un ordinateur
 * de l'équipe (scripts/run-mac-discovery.sh), sans proxy, pour ne pas payer le trafic. Les robots des
 * serveurs ne prennent plus ces recherches (lm_claim_task) ; le robot de l'ordinateur ne prend QUE
 * celles-là (lm_claim_local_task). Réservé aux utilisateurs listés dans lm_local_discovery_users.
 * -------------------------------------------------------
 */

-- Utilisateurs autorisés à basculer une campagne sur l'ordinateur dédié (ajoutés à la main, en SQL)
create table if not exists public.lm_local_discovery_users (
  user_id uuid references auth.users on delete cascade not null,
  created_at timestamptz not null default now(),
  primary key (user_id)
);

comment on table public.lm_local_discovery_users is 'Utilisateurs autorisés à faire chercher une campagne sur l''ordinateur dédié';

alter table public.lm_local_discovery_users enable row level security;

revoke all on public.lm_local_discovery_users from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_local_discovery_users to service_role;

-- Campagnes dont les recherches Google Maps sont faites par l'ordinateur dédié (une ligne = activé)
create table if not exists public.lm_local_discovery_campaigns (
  campaign_id uuid references public.lm_campaigns(id) on delete cascade not null,
  enabled_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  primary key (campaign_id)
);

comment on table public.lm_local_discovery_campaigns is 'Campagnes cherchées sur l''ordinateur dédié (sans proxy)';

alter table public.lm_local_discovery_campaigns enable row level security;

revoke all on public.lm_local_discovery_campaigns from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_local_discovery_campaigns to service_role;

-- Dernier signe de vie des robots d'ordinateur dédié (affiché sur la campagne)
create table if not exists public.lm_local_workers (
  worker_id text not null,
  seen_at timestamptz not null default now(),
  primary key (worker_id)
);

comment on table public.lm_local_workers is 'Dernier signe de vie des robots lancés sur un ordinateur dédié';

alter table public.lm_local_workers enable row level security;

revoke all on public.lm_local_workers from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_local_workers to service_role;

-- Réservation d'une tâche par un robot des serveurs. Remplace la version de 25-leadmaker-tasks.sql :
-- identique, sauf que les recherches des campagnes de l'ordinateur dédié sont laissées de côté.
create or replace function public.lm_claim_task(
  p_kinds public.lm_task_kind[],
  p_worker_id text
) returns setof public.lm_tasks
set search_path = ''
language sql
security definer
as $$
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
$$;

revoke all on function public.lm_claim_task(public.lm_task_kind[], text) from public;

grant execute on function public.lm_claim_task(public.lm_task_kind[], text) to service_role;

-- Réservation d'une recherche par le robot de l'ordinateur dédié : uniquement les campagnes marquées.
-- Note aussi son signe de vie (au plus une écriture toutes les 30 s).
create or replace function public.lm_claim_local_task(p_worker_id text) returns setof public.lm_tasks
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_claim_local_task(text) from public;

grant execute on function public.lm_claim_local_task(text) to service_role;

-- État affiché sur la page de la campagne : l'utilisateur peut-il basculer, la campagne est-elle sur
-- l'ordinateur dédié, dernier signe de vie de ce robot (recherche en cours comprise).
create or replace function public.lm_local_discovery_state(p_campaign_id uuid) returns jsonb
set search_path = ''
language plpgsql
stable
security definer
as $$
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
$$;

revoke all on function public.lm_local_discovery_state(uuid) from public;

grant execute on function public.lm_local_discovery_state(uuid) to authenticated;

-- Bascule d'une campagne entre les serveurs et l'ordinateur dédié (utilisateurs autorisés seulement).
-- Les recherches déjà en cours se terminent là où elles ont commencé ; celles en attente passent de l'autre côté.
create or replace function public.lm_set_local_discovery(p_campaign_id uuid, p_enabled boolean) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_set_local_discovery(uuid, boolean) from public;

grant execute on function public.lm_set_local_discovery(uuid, boolean) to authenticated;
