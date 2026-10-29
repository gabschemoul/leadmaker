set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_skip_attempts(p_ids uuid[])
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
       set status = 'skipped'
     where a.id = any (p_ids)
       and public.has_role_on_account(a.account_id)
       and a.status in ('pending', 'ready', 'incomplete', 'intervention_required', 'no_form', 'unreachable', 'failed', 'validated')
       and not exists (select 1 from public.lm_tasks t
                        where t.kind = 'send' and t.status = 'running' and t.payload ->> 'attempt_id' = a.id::text)
    returning a.id
  ), cancelled as (
    update public.lm_tasks t set status = 'cancelled', finished_at = now()
     where t.kind = 'send' and t.status = 'queued' and t.payload ->> 'attempt_id' in (select id::text from upd)
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;


