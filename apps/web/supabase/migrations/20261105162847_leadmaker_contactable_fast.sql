set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_autopilot_contactable(p_campaign_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- accès vérifié UNE fois (5/11/2026 : vérifié ligne à ligne, la page d'une campagne à 12 000 prospects
  -- dépassait le délai de 8 s de la base)
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    return 0;
  end if;

  return (
    select count(*)::integer
      from public.lm_prospects p
     where p.campaign_id = p_campaign_id
       and p.excluded_at is null and p.website is not null
       and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
       and not exists (select 1 from public.lm_attempts a where a.space_id = p.space_id and a.prospect_id = p.id));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_prepare_campaign(p_campaign_id uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids uuid[];
begin
  -- accès vérifié une fois, pas ligne à ligne (grosses campagnes)
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    return query select 0, 0;
    return;
  end if;

  select array_agg(p.id order by p.created_at) into v_ids
    from public.lm_prospects p
    left join public.lm_attempts a on a.space_id = p.space_id and a.prospect_id = p.id
   where p.campaign_id = p_campaign_id
     and p.excluded_at is null and p.website is not null
     and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
     and (a.id is null or public.lm_attempt_repreparable(a.status));

  if v_ids is null then
    return query select 0, 0;
    return;
  end if;

  return query select * from public.lm_prepare_prospects(v_ids, null);
end;
$function$
;


