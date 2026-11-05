set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_credit_usage(p_account_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(day date, campaign_id uuid, campaign_name text, kind public.lm_credit_kind, used integer, added integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (l.created_at at time zone 'UTC')::date, l.campaign_id, c.name::text, l.kind,
         coalesce(sum(-l.delta) filter (where l.delta < 0), 0)::integer,
         coalesce(sum(l.delta) filter (where l.delta > 0), 0)::integer
    from public.lm_credit_ledger l
    left join public.lm_campaigns c on c.id = l.campaign_id
   where l.account_id = p_account_id
     and l.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
   group by 1, 2, 3, 4
   order by 1 desc, 3 nulls first, 4;
$function$
;



-- Écrit à la main (db diff n'émet pas les droits sur les fonctions)
revoke all on function public.lm_credit_usage(uuid, integer) from public, anon;
grant execute on function public.lm_credit_usage(uuid, integer) to authenticated, service_role;
