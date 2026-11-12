set check_function_bodies = off;

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
   order by a.updated_at desc, a.id desc  -- les plus récents d'abord (12/11/2026, demande de Gabriel)
   limit 500;
$function$
;


