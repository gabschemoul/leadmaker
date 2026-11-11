-- Onglet « Gardés » : seulement les gardés payés (11/11/2026 : « Gardés 9 » pour un plafond de 3 payés). Compatible avec main.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_sort_summary(p_campaign_id uuid)
 RETURNS TABLE(sort_target text, offer text, total integer, kept integer, to_check integer, pending integer, examined bigint, credits_per_prospect integer, price_pending boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
begin
  select * into v_campaign from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_campaign.id is null then
    return;
  end if;

  return query
  select v_campaign.sort_target,
         (select s.offer from public.lm_spaces s where s.id = v_campaign.space_id),
         count(*)::integer,
         -- gardés PAYÉS seulement (11/11/2026) : au-delà d'un plafond ou sans crédits, un gardé n'est ni payé ni
         -- contactable, l'onglet « Gardés » ne le compte pas (« Gardés 9 » pour un plafond de 3 payés)
         count(*) filter (where coalesce(cp.client_choice, case when cp.sorted_version = v_campaign.sort_version
                                                                  then cp.verdict end) = 'gardee'
                            and cp.paid_at is not null)::integer,
         count(*) filter (where cp.client_choice is null and cp.sorted_version = v_campaign.sort_version
                            and cp.verdict = 'a_verifier')::integer,
         count(*) filter (where cp.client_choice is null
                            and cp.sorted_version is distinct from v_campaign.sort_version)::integer,
         (select coalesce(sum(cc.cards), 0) from public.lm_campaign_categories cc where cc.campaign_id = p_campaign_id),
         v_campaign.credits_per_prospect,
         v_campaign.price_pending
    from public.lm_campaign_prospects cp
   where cp.campaign_id = p_campaign_id;
end;
$function$
;


