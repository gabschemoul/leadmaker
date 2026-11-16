set check_function_bodies = off;

-- Formulaires douteux : plus jamais montrés au client ni envoyés (16/11/2026). « to_check » ne garde que les
-- formulaires prêts sans aucun doute qu'aucun pilote en marche n'enverra.
create or replace function public.lm_attempt_todo_kind(
  p_status public.lm_attempt_status,
  p_detail text,
  p_protection_type text,
  p_missing jsonb,
  p_validated_by uuid,
  p_autopilot_status public.lm_autopilot_status
) returns text
set search_path = ''
language sql
immutable
as $$
  select case
    when p_validated_by is not null and coalesce(p_autopilot_status in ('preview', 'running', 'paused'), false)
         and p_status in ('ready', 'incomplete')
      then null
    when p_status = 'intervention_required' then 'captcha'
    when p_status = 'incomplete' then 'unknown_field'
    -- formulaire douteux (devis, réservation, contrôle IA réservé…) : jamais envoyé, jamais montré au client
    -- (16/11/2026, décision de Gabriel : le robot tranche seul, le client ne fait que ce qu'un humain peut faire)
    when p_status = 'ready'
         and public.lm_attempt_is_clean(p_status, p_detail, p_protection_type, p_missing)
         and not coalesce(p_autopilot_status in ('preview', 'running', 'paused'), false)
      then 'to_check'
  end;
$$;
