set check_function_bodies = off;

-- Filet de sécurité du contrôle IA (16/11/2026) : un formulaire resté « prêt » parce que l'IA n'a pas répondu
-- (« contrôle IA indisponible ») n'est jamais envoyé ni montré au client. Une heure plus tard, il est repréparé UNE
-- fois (nouvelle visite du site, nouveau contrôle IA), dans sa campagne et son pilote. La tâche « prepare:<id>:ai-retry »
-- sert de marque : jamais deux reprises pour le même formulaire. p_limit borne le nombre de reprises par passage.
-- Appelant : pg_cron (lm-retry-unchecked-forms, toutes les heures) ; rôle service uniquement.
create or replace function public.lm_retry_unchecked_forms(p_limit integer default 50) returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  with picked as (
    select a.id
      from public.lm_attempts a
      join public.lm_prospects p on p.id = a.prospect_id
      join public.lm_campaigns c on c.id = a.campaign_id
     where a.status = 'ready'
       and a.detail like 'à vérifier — contrôle IA indisponible%'
       and a.updated_at < now() - interval '1 hour'
       and c.status <> 'archived'
       and p.excluded_at is null
       and public.lm_has_plan(a.account_id)
       and not public.lm_site_suppressed(a.account_id, a.space_id, p.site_key)
       and not exists (select 1 from public.lm_tasks t where t.idempotency_key = 'prepare:' || a.id::text || ':ai-retry')
     order by a.updated_at
     limit greatest(coalesce(p_limit, 0), 0)
       for update of a skip locked
  ),
  upd as (
    update public.lm_attempts a
       set status = 'pending', detail = null, missing = '[]'::jsonb, filled = '{}'::jsonb, protection_type = null,
           screenshot_before = null, form_url = null
      from picked
     where a.id = picked.id
    returning a.id, a.account_id
  ),
  ins as (
    insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
    select upd.account_id, 'prepare', jsonb_build_object('attempt_id', upd.id), 'prepare:' || upd.id::text || ':ai-retry'
      from upd
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$$;

revoke all on function public.lm_retry_unchecked_forms(integer) from public, anon, authenticated;

grant execute on function public.lm_retry_unchecked_forms(integer) to service_role;

-- toutes les heures (à la 23e minute)
select cron.schedule('lm-retry-unchecked-forms', '23 * * * *', 'select public.lm_retry_unchecked_forms()');
