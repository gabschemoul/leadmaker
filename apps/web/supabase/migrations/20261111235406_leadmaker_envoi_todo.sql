set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_approve_attempts(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with upd as (
    update public.lm_attempts a
       set status = case when ap.status in ('preview', 'paused') then a.status else 'validated' end,
           validated_by = (select auth.uid()),
           validated_at = case when ap.status in ('preview', 'paused') then a.validated_at else now() end
      from public.lm_attempts x
      left join public.lm_autopilots ap on ap.id = x.autopilot_id
     where x.id = a.id
       and a.id = any (p_ids)
       and public.lm_member(a.account_id)
       and a.status in ('ready', 'incomplete')
       and not exists (
         select 1 from jsonb_array_elements_text(a.missing) m
          where coalesce(trim(a.extra ->> m), '') = ''
       )
       and exists (select 1 from public.lm_campaigns c where c.id = a.campaign_id and c.status <> 'archived')
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_attempt_todo_kind(p_status public.lm_attempt_status, p_detail text, p_protection_type text, p_missing jsonb, p_validated_by uuid, p_autopilot_status public.lm_autopilot_status)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_validated_by is not null and coalesce(p_autopilot_status in ('preview', 'running', 'paused'), false)
         and p_status in ('ready', 'incomplete')
      then null
    when p_status = 'intervention_required' then 'captcha'
    when p_status = 'incomplete' then 'unknown_field'
    when p_status = 'ready'
         and not (public.lm_attempt_is_clean(p_status, p_detail, p_protection_type, p_missing)
                  and coalesce(p_autopilot_status in ('preview', 'running', 'paused'), false))
      then 'to_check'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_todo(p_autopilot_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::integer
    from public.lm_attempts a
    join public.lm_autopilots ap on ap.id = a.autopilot_id
   where a.autopilot_id = p_autopilot_id
     and public.lm_member(ap.account_id)
     and a.status in ('ready', 'intervention_required', 'incomplete')
     and public.lm_attempt_todo_kind(a.status, a.detail, a.protection_type, a.missing, a.validated_by, ap.status) is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_campaign_todo(p_campaign_id uuid)
 RETURNS TABLE(to_check integer, captcha integer, unknown_field integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*) filter (where x.kind = 'to_check')::integer,
         count(*) filter (where x.kind = 'captcha')::integer,
         count(*) filter (where x.kind = 'unknown_field')::integer
    from (select public.lm_attempt_todo_kind(a.status, a.detail, a.protection_type, a.missing, a.validated_by, ap.status) as kind
            from public.lm_attempts a
            left join public.lm_autopilots ap on ap.id = a.autopilot_id
           where a.campaign_id = p_campaign_id
             and a.status in ('ready', 'intervention_required', 'incomplete')
             and exists (select 1 from public.lm_campaigns c
                          where c.id = p_campaign_id and public.lm_member(c.account_id))) x;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_campaign_todo_ids(p_campaign_id uuid, p_kind text)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id
    from public.lm_attempts a
    left join public.lm_autopilots ap on ap.id = a.autopilot_id
   where a.campaign_id = p_campaign_id
     and a.status in ('ready', 'intervention_required', 'incomplete')
     and public.lm_attempt_todo_kind(a.status, a.detail, a.protection_type, a.missing, a.validated_by, ap.status) = p_kind
     and exists (select 1 from public.lm_campaigns c
                  where c.id = p_campaign_id and public.lm_member(c.account_id))
   order by a.updated_at, a.id
   limit 500;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_mark_sent_by_hand(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with upd as (
    update public.lm_attempts a
       set status = 'sent', sent_at = now(),
           validated_by = (select auth.uid()), validated_at = coalesce(a.validated_at, now())
     where a.id = any (p_ids)
       and public.lm_member(a.account_id)
       and a.status = 'intervention_required'
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_skip_todo(p_campaign_id uuid, p_kind text, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    return 0;
  end if;

  with upd as (
    update public.lm_attempts a
       set status = 'skipped'
      from public.lm_attempts x
      left join public.lm_autopilots ap on ap.id = x.autopilot_id
     where x.id = a.id
       and a.campaign_id = p_campaign_id
       and (p_ids is null or a.id = any (p_ids))
       and a.status in ('ready', 'intervention_required', 'incomplete')
       and public.lm_attempt_todo_kind(a.status, a.detail, a.protection_type, a.missing, a.validated_by, ap.status) = p_kind
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_hold(p_autopilot_id uuid, p_sends_only boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.lm_tasks t set status = 'cancelled', finished_at = now()
   where t.status = 'queued'
     and t.kind = any (case when p_sends_only then array['send']::public.lm_task_kind[]
                            else array['send', 'prepare']::public.lm_task_kind[] end)
     and t.payload ->> 'attempt_id' in (select a.id::text from public.lm_attempts a where a.autopilot_id = p_autopilot_id);

  if not p_sends_only then
    update public.lm_attempts a set status = 'ready', validated_at = null
     where a.autopilot_id = p_autopilot_id and a.status = 'validated';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_validate_clean(p_autopilot_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with upd as (
    update public.lm_attempts a
       set status = 'validated', validated_at = now(), validated_by = coalesce(a.validated_by, (select auth.uid()))
     where a.autopilot_id = p_autopilot_id
       and (public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing)
            or (a.validated_by is not null and a.status in ('ready', 'incomplete')
                and not exists (select 1 from jsonb_array_elements_text(a.missing) m
                                 where coalesce(trim(a.extra ->> m), '') = '')))
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;


grant execute on function public.lm_attempt_todo_kind(public.lm_attempt_status, text, text, jsonb, uuid, public.lm_autopilot_status)
  to authenticated, service_role;

revoke all on function public.lm_campaign_todo(uuid) from public;
grant execute on function public.lm_campaign_todo(uuid) to authenticated, service_role;

revoke all on function public.lm_campaign_todo_ids(uuid, text) from public;
grant execute on function public.lm_campaign_todo_ids(uuid, text) to authenticated, service_role;

revoke all on function public.lm_approve_attempts(uuid[]) from public;
grant execute on function public.lm_approve_attempts(uuid[]) to authenticated, service_role;

revoke all on function public.lm_mark_sent_by_hand(uuid[]) from public;
grant execute on function public.lm_mark_sent_by_hand(uuid[]) to authenticated, service_role;

revoke all on function public.lm_skip_todo(uuid, text, uuid[]) from public;
grant execute on function public.lm_skip_todo(uuid, text, uuid[]) to authenticated, service_role;

revoke all on function public.lm_autopilot_todo(uuid) from public;
grant execute on function public.lm_autopilot_todo(uuid) to authenticated, service_role;
