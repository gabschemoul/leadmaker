-- 3/11/2026 : la page d'une grosse campagne tombait en erreur 500 (délai de 8 s dépassé) : lm_campaign_progress
-- vérifiait les droits ligne par ligne (RLS) sur 16 000 quartiers et 24 000 crédits, 3,7 s par appel.
-- Désormais SECURITY DEFINER avec une seule vérification (organisation + double authentification), mêmes chiffres,
-- quartiers comptés une fois ; index des débits par campagne. Compatible avec le code en ligne (même signature).

CREATE INDEX ix_lm_credit_ledger_campaign_id ON public.lm_credit_ledger USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_progress(p_campaign_id uuid)
 RETURNS TABLE(zones integer, categories integer, searches_total bigint, searches_done bigint, in_flight bigint, abandoned integer, productive integer, prospects bigint, cards bigint, last_search_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_zones integer;
begin
  select c.account_id into v_account_id from public.lm_campaigns c where c.id = p_campaign_id;

  if v_account_id is null
     or (coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
         and not (public.has_role_on_account(v_account_id) and public.is_mfa_compliant())) then
    return;
  end if;

  select count(*)::integer into v_zones
    from public.lm_campaign_zones z where z.campaign_id = p_campaign_id and not z.removed;

  return query
  select v_zones,
         count(cc.gcid) filter (where not cc.removed)::integer,
         v_zones * count(cc.gcid) filter (where not cc.removed),
         coalesce(sum(cc.searches), 0),
         coalesce(sum(cc.in_flight), 0),
         count(*) filter (where cc.abandoned and not cc.removed)::integer,
         count(*) filter (where cc.kept > 0 and not cc.removed)::integer,
         (select count(*) from public.lm_credit_ledger l
           where l.campaign_id = p_campaign_id and l.kind = 'discovery' and l.delta < 0),
         coalesce(sum(cc.cards), 0),
         (select max(s.created_at) from public.lm_searches s where s.campaign_id = p_campaign_id)
    from public.lm_campaign_categories cc
   where cc.campaign_id = p_campaign_id;
end;
$function$
;



revoke all on function public.lm_campaign_progress(uuid) from public;

grant execute on function public.lm_campaign_progress(uuid) to authenticated, service_role;
