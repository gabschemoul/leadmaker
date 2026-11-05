-- Les robots tournent pendant la migration : tous les verrous des tables modifiées pris d'un coup, dans un ordre
-- fixe, dans un bloc DO (voir 20261105120031). Au-delà de 30 s d'attente, la migration échoue proprement.
do $$
begin
  perform set_config('lock_timeout', '30s', true);

  lock table public.lm_credit_ledger, public.lm_searches, public.lm_prospects, public.lm_attempts,
             public.lm_tasks in access exclusive mode;
end;
$$;

drop policy "lm_attempts_read" on "public"."lm_attempts";

drop policy "restrict_mfa_lm_attempts" on "public"."lm_attempts";

drop policy "lm_credit_ledger_read" on "public"."lm_credit_ledger";

drop policy "restrict_mfa_lm_credit_ledger" on "public"."lm_credit_ledger";

drop policy "lm_prospects_read" on "public"."lm_prospects";

drop policy "restrict_mfa_lm_prospects" on "public"."lm_prospects";

drop policy "lm_searches_read" on "public"."lm_searches";

drop policy "restrict_mfa_lm_searches" on "public"."lm_searches";

drop policy "lm_tasks_read" on "public"."lm_tasks";

drop policy "restrict_mfa_lm_tasks" on "public"."lm_tasks";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_user_account_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.account_id from public.accounts_memberships m where m.user_id = (select auth.uid());
$function$
;


  create policy "lm_attempts_read"
  on "public"."lm_attempts"
  as permissive
  for select
  to authenticated
using ((account_id IN ( SELECT public.lm_user_account_ids() AS lm_user_account_ids)));



  create policy "restrict_mfa_lm_attempts"
  on "public"."lm_attempts"
  as restrictive
  for all
  to authenticated
using (( SELECT public.is_mfa_compliant() AS is_mfa_compliant));



  create policy "lm_credit_ledger_read"
  on "public"."lm_credit_ledger"
  as permissive
  for select
  to authenticated
using ((account_id IN ( SELECT public.lm_user_account_ids() AS lm_user_account_ids)));



  create policy "restrict_mfa_lm_credit_ledger"
  on "public"."lm_credit_ledger"
  as restrictive
  for all
  to authenticated
using (( SELECT public.is_mfa_compliant() AS is_mfa_compliant));



  create policy "lm_prospects_read"
  on "public"."lm_prospects"
  as permissive
  for select
  to authenticated
using ((account_id IN ( SELECT public.lm_user_account_ids() AS lm_user_account_ids)));



  create policy "restrict_mfa_lm_prospects"
  on "public"."lm_prospects"
  as restrictive
  for all
  to authenticated
using (( SELECT public.is_mfa_compliant() AS is_mfa_compliant));



  create policy "lm_searches_read"
  on "public"."lm_searches"
  as permissive
  for select
  to authenticated
using ((account_id IN ( SELECT public.lm_user_account_ids() AS lm_user_account_ids)));



  create policy "restrict_mfa_lm_searches"
  on "public"."lm_searches"
  as restrictive
  for all
  to authenticated
using (( SELECT public.is_mfa_compliant() AS is_mfa_compliant));



  create policy "lm_tasks_read"
  on "public"."lm_tasks"
  as permissive
  for select
  to authenticated
using ((account_id IN ( SELECT public.lm_user_account_ids() AS lm_user_account_ids)));



  create policy "restrict_mfa_lm_tasks"
  on "public"."lm_tasks"
  as restrictive
  for all
  to authenticated
using (( SELECT public.is_mfa_compliant() AS is_mfa_compliant));





-- Écrit à la main (db diff n'émet pas les droits sur les fonctions)
revoke all on function public.lm_user_account_ids() from public, anon;
grant execute on function public.lm_user_account_ids() to authenticated, service_role;
