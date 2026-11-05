set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_delete_prospects(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with del as (
    delete from public.lm_prospects p
     where p.id = any (p_ids)
       and public.has_permission((select auth.uid()), p.account_id, 'settings.manage'::public.app_permissions)
       and coalesce(public.is_mfa_compliant(), false)
    returning 1
  )
  select count(*) into v_count from del;

  return v_count;
end;
$function$
;


