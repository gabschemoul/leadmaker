set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_autopilot_counts(p_autopilot_id uuid)
 RETURNS TABLE(sent integer, in_flight integer, preview_ready integer, aside integer, total integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- envoyés = confirmés seulement : « à vérifier » (aucune confirmation visible) n'est plus compté (12/11/2026,
  -- 151 sur 274 étaient en fait bloqués par une vérification anti-robot) ; le pilote continue jusqu'au vrai nombre
  select count(*) filter (where a.status = 'sent')::integer,
         count(*) filter (where a.status in ('pending', 'preparing', 'validated', 'sending'))::integer,
         count(*) filter (where public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))::integer,
         count(*) filter (where a.status not in ('sent', 'to_verify', 'pending', 'preparing', 'validated', 'sending')
                            and not public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))::integer,
         count(*)::integer
    from public.lm_attempts a
   where a.autopilot_id = p_autopilot_id;
$function$
;


