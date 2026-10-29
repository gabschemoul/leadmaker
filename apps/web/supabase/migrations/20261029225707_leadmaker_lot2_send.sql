set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_finish_send(p_attempt_id uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account uuid;
  v_campaign uuid;
  v_status public.lm_attempt_status := (p_result ->> 'status')::public.lm_attempt_status;
  v_submitted boolean := coalesce((p_result ->> 'submitted')::boolean, false);
begin
  update public.lm_attempts
     set status = v_status,
         detail = p_result ->> 'detail',
         protection_type = coalesce(p_result ->> 'protection_type', protection_type),
         screenshot_after = coalesce(p_result ->> 'screenshot_after', screenshot_after),
         missing = coalesce(p_result -> 'missing', missing),
         template_used = coalesce(p_result ->> 'template_used', template_used),
         subject = coalesce(p_result ->> 'subject', subject),
         body = coalesce(p_result ->> 'body', body),
         sent_at = case when v_submitted then now() else sent_at end
   where id = p_attempt_id and status = 'sending'
  returning account_id, campaign_id into v_account, v_campaign;

  if v_account is null then
    return false;
  end if;

  if v_submitted then
    perform public.lm_debit_credits(v_account, 'outreach', 1, 'send:' || p_attempt_id::text,
                                    'form submitted', v_campaign);
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_mark_attempts(p_ids uuid[], p_outcome text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
  v_status public.lm_attempt_status;
begin
  if p_outcome = 'sent' then
    v_status := 'sent';
  elsif p_outcome = 'failed' then
    v_status := 'failed';
  else
    raise exception 'unknown outcome %', p_outcome using errcode = 'check_violation';
  end if;

  with upd as (
    update public.lm_attempts a
       set status = v_status
     where a.id = any (p_ids)
       and public.has_role_on_account(a.account_id)
       and a.status = 'to_verify'
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_queue_sends()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_queued integer := 0;
  r record;
  v_account_today integer;
  v_account_limit integer;
  v_balance integer;
  v_campaign_today integer;
begin
  -- Envois interrompus
  update public.lm_attempts a
     set status = 'to_verify', sent_at = coalesce(sent_at, now()),
         detail = 'envoi interrompu (robot arrêté) : vérifiez sur le site si le message est parti'
   where a.status = 'sending' and a.updated_at < now() - interval '20 minutes';

  for r in
    select a.id, a.account_id, a.campaign_id, c.daily_limit
      from public.lm_attempts a
      join public.lm_campaigns c on c.id = a.campaign_id
     where a.status = 'validated'
       and not exists (select 1 from public.lm_tasks t
                        where t.kind = 'send' and t.status in ('queued', 'running')
                          and t.payload ->> 'attempt_id' = a.id::text)
     order by a.validated_at
  loop
    select coalesce(p.daily_send_limit, 0), coalesce(cr.outreach_balance, 0) into v_account_limit, v_balance
      from public.lm_account_credits cr left join public.lm_plans p on p.id = cr.plan_id
     where cr.account_id = r.account_id;

    if v_balance is null or v_balance <= 0 then
      continue;
    end if;

    select count(*)::integer into v_account_today from public.lm_attempts a
     where a.account_id = r.account_id
       and (a.status = 'sending' or (a.sent_at is not null and a.sent_at >= date_trunc('day', now())));
    -- tâches déjà en file aujourd'hui (pas encore « en envoi »)
    v_account_today := v_account_today + (
      select count(*)::integer from public.lm_tasks t
       where t.kind = 'send' and t.status = 'queued' and t.account_id = r.account_id);

    if v_account_today >= v_account_limit then
      continue;
    end if;

    v_campaign_today := public.lm_sends_today(r.campaign_id) + (
      select count(*)::integer from public.lm_tasks t
        join public.lm_attempts a2 on a2.id::text = t.payload ->> 'attempt_id'
       where t.kind = 'send' and t.status = 'queued' and a2.campaign_id = r.campaign_id);

    if v_campaign_today >= r.daily_limit then
      continue;
    end if;

    insert into public.lm_tasks (account_id, kind, payload, idempotency_key, max_attempts)
    values (r.account_id, 'send', jsonb_build_object('attempt_id', r.id),
            'send:' || r.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text, 1)
    on conflict (idempotency_key) do nothing;

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_sends_today(p_campaign_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select count(*)::integer from public.lm_attempts a
   where a.campaign_id = p_campaign_id
     and (a.status = 'sending' or (a.sent_at is not null and a.sent_at >= date_trunc('day', now())));
$function$
;



-- Droits (migra n'écrit pas les GRANT EXECUTE)
grant execute on function public.lm_sends_today(uuid) to authenticated, service_role;
revoke all on function public.lm_queue_sends() from public;
grant execute on function public.lm_queue_sends() to service_role;
revoke all on function public.lm_finish_send(uuid, jsonb) from public;
grant execute on function public.lm_finish_send(uuid, jsonb) to service_role;
revoke all on function public.lm_mark_attempts(uuid[], text) from public;
grant execute on function public.lm_mark_attempts(uuid[], text) to authenticated, service_role;
