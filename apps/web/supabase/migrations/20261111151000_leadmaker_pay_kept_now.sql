-- Gardés payés tout de suite, même pendant la mesure du prix (11/11/2026, choix 2 de Gabriel : « c'est pas grave
-- si on perd quelques crédits ») : 1 crédit pendant la mesure, puis le palier mesuré. Avant, ils attendaient 300
-- triés pour devenir contactables. Rattrapage : les gardés en attente des campagnes non archivées sont réglés.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_settle_account_kept(p_account_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign uuid;
  v_count integer := 0;
begin
  for v_campaign in
    select c.id
      from public.lm_campaigns c
     where c.account_id = p_account_id and c.status <> 'archived'
       and nullif(trim(c.sort_target), '') is not null
       and exists (select 1 from public.lm_campaign_prospects cp
                    where cp.campaign_id = c.id and cp.paid_at is null
                      and coalesce(cp.client_choice, cp.verdict) = 'gardee')
     order by c.created_at
  loop
    v_count := v_count + public.lm_settle_kept(v_campaign, null);

    -- crédits de nouveau épuisés : inutile d'essayer les campagnes suivantes (somme écrite ici :
    -- lm_available_credits renvoie null hors d'une session membre ou service, par exemple sous pg_cron)
    exit when coalesce((select ac.discovery_balance from public.lm_account_credits ac where ac.account_id = p_account_id), 0)
              + public.lm_pack_credits(p_account_id) <= 0;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_settle_kept(p_campaign_id uuid, p_prospect_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_count integer := 0;
  r record;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  -- 11/11/2026 (Gabriel, choix 2) : un gardé est payé tout de suite, même pendant la mesure du prix, au tarif du
  -- moment (1 crédit au départ) ; une fois le prix mesuré, les suivants le sont au prix mesuré. Avant, les gardés
  -- attendaient 300 triés pour être payés, donc contactables (« 3 à contacter » sur 69 gardés).
  if v_campaign.id is null then
    return 0;
  end if;

  -- Solde de l'organisation verrouillé AVANT de regarder si l'entreprise est déjà payée ailleurs : deux règlements
  -- simultanés de la même entreprise dans deux campagnes (robot de tri + recharge qui règle l'attente) se suivent
  -- au lieu de la débiter deux fois (relecture du 11/11/2026)
  perform 1 from public.lm_account_credits where account_id = v_campaign.account_id for update;

  for r in
    select cp.prospect_id,
           exists (select 1 from public.lm_campaign_prospects o
                    where o.prospect_id = cp.prospect_id and o.campaign_id <> cp.campaign_id
                      and o.paid_at is not null) as already_paid
      from public.lm_campaign_prospects cp
     where cp.campaign_id = p_campaign_id
       and (p_prospect_id is null or cp.prospect_id = p_prospect_id)
       and cp.paid_at is null
       and coalesce(cp.client_choice, cp.verdict) = 'gardee'
     order by cp.sorted_at nulls last
     for update of cp skip locked
  loop
    if not r.already_paid
       and not public.lm_debit_credits(v_campaign.account_id, 'discovery', greatest(v_campaign.credits_per_prospect, 1),
                                       'keep:' || p_campaign_id::text || ':' || r.prospect_id::text, 'kept',
                                       p_campaign_id) then
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      exit;
    end if;

    update public.lm_campaign_prospects
       set paid_at = now(), credits = case when r.already_paid then 0 else greatest(v_campaign.credits_per_prospect, 1) end
     where campaign_id = p_campaign_id and prospect_id = r.prospect_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;



-- Rattrapage des gardés qui attendaient la fin de la mesure du prix
select public.lm_settle_kept(c.id)
  from public.lm_campaigns c
 where c.status <> 'archived' and nullif(trim(c.sort_target), '') is not null
   and exists (select 1 from public.lm_campaign_prospects cp
                where cp.campaign_id = c.id and cp.paid_at is null
                  and coalesce(cp.client_choice, cp.verdict) = 'gardee');
