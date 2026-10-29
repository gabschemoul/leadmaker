-- Lot 2 : préparation des formulaires et validation (captures, fonctions, temps réel)
insert into storage.buckets (id, name, public)
values ('lm_screenshots', 'lm_screenshots', false)
on conflict (id) do nothing;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_attempt_counts(p_space_id uuid)
 RETURNS TABLE(status public.lm_attempt_status, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select a.status, count(*) from public.lm_attempts a where a.space_id = p_space_id group by a.status;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_attempt_repreparable(p_status public.lm_attempt_status)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_status in ('no_form', 'unreachable', 'intervention_required', 'failed', 'skipped');
$function$
;

CREATE OR REPLACE FUNCTION public.lm_exclude_attempts(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
  v_prospects uuid[];
begin
  with upd as (
    update public.lm_attempts a
       set status = 'excluded'
     where a.id = any (p_ids)
       and public.has_role_on_account(a.account_id)
       and a.status not in ('sending', 'sent', 'to_verify', 'excluded')
    returning a.prospect_id
  )
  select count(*), array_agg(prospect_id) into v_count, v_prospects from upd;

  if v_prospects is not null then
    perform public.lm_exclude_prospects(v_prospects);
  end if;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_prepare(p_attempt_id uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prospect uuid;
  v_email text;
begin
  update public.lm_attempts
     set status = (p_result ->> 'status')::public.lm_attempt_status,
         template_name = coalesce(p_result ->> 'template_name', template_name),
         template_used = coalesce(p_result ->> 'template_used', template_used),
         subject = coalesce(p_result ->> 'subject', subject),
         body = coalesce(p_result ->> 'body', body),
         form_url = p_result ->> 'form_url',
         filled = coalesce(p_result -> 'filled', '{}'::jsonb),
         missing = coalesce(p_result -> 'missing', '[]'::jsonb),
         protection_type = p_result ->> 'protection_type',
         screenshot_before = p_result ->> 'screenshot_before',
         detail = p_result ->> 'detail'
   where id = p_attempt_id and status in ('pending', 'preparing')
  returning prospect_id into v_prospect;

  if v_prospect is null then
    return false;
  end if;

  -- Email relevé sur le site : enregistré sur le prospect s'il n'en avait pas
  v_email := nullif(trim(coalesce(p_result ->> 'found_email', '')), '');

  if v_email is not null then
    update public.lm_prospects set found_email = v_email where id = v_prospect and found_email is null;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_prepare_campaign(p_campaign_id uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids uuid[];
begin
  select array_agg(p.id order by p.created_at) into v_ids
    from public.lm_prospects p
    left join public.lm_attempts a on a.space_id = p.space_id and a.prospect_id = p.id
   where p.campaign_id = p_campaign_id
     and public.has_role_on_account(p.account_id)
     and p.excluded_at is null and p.website is not null
     and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
     and (a.id is null or public.lm_attempt_repreparable(a.status));

  if v_ids is null then
    return query select 0, 0;
    return;
  end if;

  return query select * from public.lm_prepare_prospects(v_ids, null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_prepare_prospects(p_ids uuid[], p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_queued integer := 0;
  v_skipped integer := 0;
  v_round text := extract(epoch from clock_timestamp())::bigint::text;
  v_attempt_id uuid;
  v_ready integer;
  v_cap integer;
  r record;
begin
  for r in
    select p.id, p.account_id, p.space_id, p.website, p.site_key, p.excluded_at,
           coalesce(p.campaign_id, p_campaign_id) as campaign_id
      from public.lm_prospects p
     where p.id = any (p_ids) and public.has_role_on_account(p.account_id)
     order by p.created_at
  loop
    v_attempt_id := null;

    -- Sans site web, exclu ou sans campagne : rien à préparer
    if r.excluded_at is not null or r.website is null or r.site_key like 'maps:%' or r.site_key like 'tel:%'
       or r.campaign_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if not exists (select 1 from public.lm_sender_profiles s where s.space_id = r.space_id) then
      raise exception 'no sender profile for space %', r.space_id using errcode = 'P0001', hint = 'no_sender';
    end if;

    if not exists (select 1 from public.lm_campaigns c
                    where c.id = r.campaign_id and c.space_id = r.space_id and public.lm_templates_usable(c.templates)) then
      raise exception 'campaign % has no message', r.campaign_id using errcode = 'P0001', hint = 'no_messages';
    end if;

    -- Plafond de formulaires prêts non validés (par espace)
    select count(*) into v_ready from public.lm_attempts a
     where a.space_id = r.space_id and a.status in ('pending', 'preparing', 'ready', 'incomplete');
    select ready_forms_cap into v_cap from public.lm_spaces where id = r.space_id;

    if v_ready >= v_cap then
      raise exception 'ready forms cap reached for space %', r.space_id using errcode = 'P0001', hint = 'cap_reached';
    end if;

    insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status)
    values (r.account_id, r.space_id, r.campaign_id, r.id, 'pending')
    on conflict (space_id, prospect_id) do update
      set status = 'pending', campaign_id = excluded.campaign_id, detail = null, missing = '[]'::jsonb,
          filled = '{}'::jsonb, protection_type = null, screenshot_before = null, form_url = null
      where public.lm_attempt_repreparable(public.lm_attempts.status)
    returning id into v_attempt_id;

    if v_attempt_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
    values (r.account_id, 'prepare', jsonb_build_object('attempt_id', v_attempt_id),
            'prepare:' || v_attempt_id::text || ':' || v_round)
    on conflict (idempotency_key) do nothing;

    v_queued := v_queued + 1;
  end loop;

  return query select v_queued, v_skipped;
end;
$function$
;

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
       and a.status in ('pending', 'ready', 'incomplete', 'intervention_required', 'no_form', 'unreachable', 'failed')
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_templates_usable(p_templates jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from jsonb_array_elements(
             case when jsonb_typeof(p_templates) = 'array' then p_templates
                  when jsonb_typeof(p_templates -> 'messages') = 'array' then p_templates -> 'messages'
                  else '[]'::jsonb end) m
     where length(trim(coalesce(m ->> 'body', ''))) > 0
  );
$function$
;

CREATE OR REPLACE FUNCTION public.lm_update_attempt(p_id uuid, p_subject text, p_body text, p_extra jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_found boolean;
begin
  if length(coalesce(p_body, '')) > 5000 or length(coalesce(p_subject, '')) > 200 then
    raise exception 'message too long' using errcode = 'check_violation';
  end if;

  with upd as (
    update public.lm_attempts a
       set subject = p_subject, body = p_body, extra = coalesce(p_extra, '{}'::jsonb)
     where a.id = p_id
       and public.has_role_on_account(a.account_id)
       and a.status in ('ready', 'incomplete')
    returning 1
  )
  select exists (select 1 from upd) into v_found;

  return v_found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_validate_attempts(p_ids uuid[])
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
       set status = 'validated', validated_by = (select auth.uid()), validated_at = now()
     where a.id = any (p_ids)
       and public.has_role_on_account(a.account_id)
       and a.status in ('ready', 'incomplete')
       and not exists (
         select 1 from jsonb_array_elements_text(a.missing) m
          where coalesce(trim(a.extra ->> m), '') = ''
       )
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;


  create policy "lm_screenshots_select"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'lm_screenshots'::text) AND public.has_role_on_account(((storage.foldername(name))[1])::uuid)));

-- Droits (migra n'écrit pas les GRANT EXECUTE)
grant execute on function public.lm_templates_usable(jsonb) to authenticated, service_role;
grant execute on function public.lm_attempt_repreparable(public.lm_attempt_status) to authenticated, service_role;
revoke all on function public.lm_prepare_prospects(uuid[], uuid) from public;
grant execute on function public.lm_prepare_prospects(uuid[], uuid) to authenticated, service_role;
revoke all on function public.lm_prepare_campaign(uuid) from public;
grant execute on function public.lm_prepare_campaign(uuid) to authenticated, service_role;
revoke all on function public.lm_finish_prepare(uuid, jsonb) from public;
grant execute on function public.lm_finish_prepare(uuid, jsonb) to service_role;
grant execute on function public.lm_attempt_counts(uuid) to authenticated, service_role;
revoke all on function public.lm_validate_attempts(uuid[]) from public;
grant execute on function public.lm_validate_attempts(uuid[]) to authenticated, service_role;
revoke all on function public.lm_skip_attempts(uuid[]) from public;
grant execute on function public.lm_skip_attempts(uuid[]) to authenticated, service_role;
revoke all on function public.lm_exclude_attempts(uuid[]) from public;
grant execute on function public.lm_exclude_attempts(uuid[]) to authenticated, service_role;
revoke all on function public.lm_update_attempt(uuid, text, text, jsonb) from public;
grant execute on function public.lm_update_attempt(uuid, text, text, jsonb) to authenticated, service_role;

-- Affichage en direct des résultats de préparation (filtré par la RLS)
alter publication supabase_realtime add table public.lm_attempts;
