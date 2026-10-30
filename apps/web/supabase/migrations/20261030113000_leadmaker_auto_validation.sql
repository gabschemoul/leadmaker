set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_auto_validation_allowed(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select p.auto_validation
                     from public.lm_account_credits c
                     join public.lm_plans p on p.id = c.plan_id
                    where c.account_id = p_account_id), false);
$function$
;

revoke all on function public.lm_auto_validation_allowed(uuid) from public;
grant execute on function public.lm_auto_validation_allowed(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lm_campaigns_check_auto_validation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.auto_validation and not coalesce(old.auto_validation, false)
     and not public.lm_auto_validation_allowed(new.account_id) then
    raise exception 'auto validation not included in plan' using errcode = 'P0001', hint = 'plan';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE TRIGGER lm_campaigns_auto_validation BEFORE INSERT OR UPDATE OF auto_validation ON public.lm_campaigns FOR EACH ROW EXECUTE FUNCTION public.lm_campaigns_check_auto_validation();

CREATE OR REPLACE FUNCTION public.lm_finish_prepare(p_attempt_id uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prospect uuid;
  v_email text;
  v_attempt record;
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
  returning prospect_id, account_id, campaign_id, status, detail, missing, protection_type into v_attempt;

  v_prospect := v_attempt.prospect_id;

  if v_prospect is null then
    return false;
  end if;

  -- Validation automatique (option de la campagne + forfait) : seulement un formulaire prêt sans la moindre alerte
  if v_attempt.status = 'ready' and v_attempt.detail is null and v_attempt.protection_type is null
     and coalesce(jsonb_array_length(v_attempt.missing), 0) = 0
     and exists (select 1 from public.lm_campaigns c where c.id = v_attempt.campaign_id and c.auto_validation)
     and public.lm_auto_validation_allowed(v_attempt.account_id) then
    update public.lm_attempts
       set status = 'validated', validated_at = now(), validated_by = null
     where id = p_attempt_id;
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
