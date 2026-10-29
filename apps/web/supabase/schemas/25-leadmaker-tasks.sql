/*
 * -------------------------------------------------------
 * Section: LeadMaker task queue
 * File de tâches Postgres pour les workers Python : réservation atomique
 * (for update skip locked), idempotence par clé, reprise avec délai.
 * -------------------------------------------------------
 */
create table if not exists public.lm_tasks (
  id bigint generated always as identity,
  account_id uuid references public.accounts(id) on delete cascade not null,
  kind public.lm_task_kind not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status public.lm_task_status not null default 'queued',
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  worker_id text,
  locked_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  constraint lm_tasks_idempotency_key_unique unique (idempotency_key),
  constraint lm_tasks_max_attempts_positive check (max_attempts > 0)
);

comment on table public.lm_tasks is 'File de travail des workers (découverte, préparation, envoi)';

alter table public.lm_tasks enable row level security;

revoke all on public.lm_tasks from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_tasks to service_role;

grant select on table public.lm_tasks to authenticated;

create trigger lm_tasks_set_timestamps
  before insert or update on public.lm_tasks
  for each row execute function public.trigger_set_timestamps();

create index if not exists ix_lm_tasks_queue
  on public.lm_tasks (kind, priority, run_after)
  where status = 'queued';

create index if not exists ix_lm_tasks_account_id_created_at
  on public.lm_tasks (account_id, created_at desc);

create policy "lm_tasks_read" on public.lm_tasks for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_tasks" on public.lm_tasks
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Réserve une tâche prête pour un worker. Renvoie 0 ou 1 ligne.
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
     select id from public.lm_tasks
      where status = 'queued' and kind = any (p_kinds) and run_after <= now()
      order by priority, created_at
      for update skip locked
      limit 1
   )
  returning t.*;
$$;

revoke all on function public.lm_claim_task(public.lm_task_kind[], text) from public;

grant execute on function public.lm_claim_task(public.lm_task_kind[], text) to service_role;

create or replace function public.lm_complete_task(p_id bigint, p_result jsonb) returns void
set search_path = ''
language sql
security definer
as $$
  update public.lm_tasks
     set status = 'done', result = p_result, finished_at = now(), error = null
   where id = p_id and status = 'running';
$$;

revoke all on function public.lm_complete_task(bigint, jsonb) from public;

grant execute on function public.lm_complete_task(bigint, jsonb) to service_role;

-- Échec : remise en file avec délai croissant tant qu'il reste des essais.
create or replace function public.lm_fail_task(p_id bigint, p_error text) returns void
set search_path = ''
language sql
security definer
as $$
  update public.lm_tasks
     set status = case when attempts >= max_attempts then 'failed'::public.lm_task_status else 'queued'::public.lm_task_status end,
         error = p_error,
         worker_id = null,
         locked_at = null,
         finished_at = case when attempts >= max_attempts then now() else null end,
         run_after = now() + make_interval(secs => 30 * power(2, attempts))
   where id = p_id and status = 'running';
$$;

revoke all on function public.lm_fail_task(bigint, text) from public;

grant execute on function public.lm_fail_task(bigint, text) to service_role;

-- Tâche bloquée (worker mort) : remise en file après 15 minutes sans nouvelles.
create or replace function public.lm_requeue_stale_tasks(p_stale interval default '15 minutes') returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  with stale as (
    update public.lm_tasks
       set status = case when attempts >= max_attempts then 'failed'::public.lm_task_status else 'queued'::public.lm_task_status end,
           error = coalesce(error, 'worker timeout'),
           worker_id = null,
           locked_at = null
     where status = 'running' and locked_at < now() - p_stale
    returning 1
  )
  select count(*) into v_count from stale;

  return v_count;
end;
$$;

revoke all on function public.lm_requeue_stale_tasks(interval) from public;

grant execute on function public.lm_requeue_stale_tasks(interval) to service_role;
