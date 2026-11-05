set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_seats_available(p_account_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer;
begin
  if not public.lm_member(p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  v_limit := public.lm_seat_limit(p_account_id);

  if v_limit >= 2147483647 then
    return null;
  end if;

  return greatest(0, v_limit
    - (select count(*) from public.accounts_memberships m where m.account_id = p_account_id)::integer
    - (select count(*) from public.invitations i where i.account_id = p_account_id and i.expires_at > now())::integer);
end;
$function$
;



-- Écrit à la main (db diff n'émet pas les droits sur les fonctions)
revoke all on function public.lm_seats_available(uuid) from public, anon;
grant execute on function public.lm_seats_available(uuid) to authenticated, service_role;
