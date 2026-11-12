set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_prospect_counts(p_account_id uuid)
 RETURNS TABLE(campaign_id uuid, prospects bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, (select count(*) from public.lm_prospects p where p.campaign_id = c.id)
    from public.lm_campaigns c
   where c.account_id = p_account_id
     and public.lm_member(p_account_id);
$function$
;


revoke all on function public.lm_campaign_prospect_counts(uuid) from public, anon;

grant execute on function public.lm_campaign_prospect_counts(uuid) to authenticated, service_role;
