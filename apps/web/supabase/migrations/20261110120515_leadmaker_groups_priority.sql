-- 10/11/2026 : la proposition des groupes passe en tête de file de tri (priorité 40), au lieu d'attendre tout le tri.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_finish_sort(p_campaign_id uuid, p_prospect_id uuid, p_version integer, p_verdict text, p_group text, p_reason text, p_site_status text DEFAULT NULL::text, p_site_text text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_place_id text;
  v_count integer;
  v_gcid text;
  v_settings public.lm_discovery_settings%rowtype;
begin
  if p_verdict not in ('gardee', 'a_verifier', 'ecartee') then
    raise exception 'invalid verdict %', p_verdict using errcode = 'P0001';
  end if;

  -- Texte du site : pour tous les clients, même si l'avis arrive trop tard
  if p_site_status in ('ok', 'unreachable', 'social') then
    select p.google_place_id into v_place_id from public.lm_prospects p where p.id = p_prospect_id;

    if v_place_id is not null then
      update public.lm_places
         set site_status = p_site_status,
             site_text = case when p_site_status = 'ok' then left(p_site_text, 8000) end,
             site_read_at = now(),
             -- site relu sans souci : il n'est plus mort (étape 3 de l'annuaire)
             site_dead_at = case when p_site_status = 'ok' then null else site_dead_at end
       where google_place_id = v_place_id;
    end if;
  end if;

  update public.lm_campaign_prospects cp
     set verdict = p_verdict,
         -- pas de groupe tant que la campagne n'en a pas (sinon tout serait rangé « autre » et jamais reclassé)
         group_key = case when (select jsonb_array_length(c.sort_groups) from public.lm_campaigns c
                                 where c.id = p_campaign_id) > 0
                          then left(nullif(trim(p_group), ''), 60) end,
         reason = left(nullif(trim(p_reason), ''), 300),
         sorted_at = now(),
         sorted_version = p_version
   where cp.campaign_id = p_campaign_id and cp.prospect_id = p_prospect_id
     and p_version = (select c.sort_version from public.lm_campaigns c where c.id = p_campaign_id)
  returning cp.gcid into v_gcid;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return false;
  end if;

  select * into v_settings from public.lm_discovery_settings where id;

  -- Rendement du tri par activité ; une activité qui ne donne presque que des entreprises hors cible est
  -- abandonnée (la recherche cesse d'y dépenser du proxy)
  if v_gcid is not null then
    update public.lm_campaign_categories cc
       set sorted = cc.sorted + 1,
           sorted_kept = cc.sorted_kept + (p_verdict = 'gardee')::integer,
           abandoned = cc.abandoned
             or (cc.sorted + 1 >= v_settings.sort_abandon_after
                 and (cc.sorted_kept + (p_verdict = 'gardee')::integer)
                       < v_settings.sort_abandon_rate * (cc.sorted + 1))
     where cc.campaign_id = p_campaign_id and cc.gcid = v_gcid;
  end if;

  perform public.lm_measure_sort_price(p_campaign_id);

  if p_verdict = 'gardee' then
    perform public.lm_settle_kept(p_campaign_id, p_prospect_id);

    -- Groupes (§4.3) : assez de gardées et pas encore de groupes → une tâche de proposition (une par cible)
    -- groupes fins : 3 fois plus de gardées avant de proposer, pour voir aussi les sous-activités rares
    if (select c.sort_groups = '[]'::jsonb from public.lm_campaigns c where c.id = p_campaign_id)
       and (select count(*) from public.lm_campaign_prospects cp
             where cp.campaign_id = p_campaign_id and cp.sorted_version = p_version and cp.verdict = 'gardee')
           >= v_settings.sort_groups_after
              * (case when (select c.sort_groups_fine from public.lm_campaigns c where c.id = p_campaign_id) then 3 else 1 end) then
      -- priorité haute : sinon la proposition attend derrière tout le reste de la file de tri (10/11/2026)
      insert into public.lm_tasks (account_id, kind, payload, idempotency_key, priority)
      select c.account_id, 'sort',
             jsonb_build_object('action', 'groups', 'campaign_id', c.id, 'version', p_version),
             'sortgroups:' || c.id::text || ':' || p_version::text, 40
        from public.lm_campaigns c where c.id = p_campaign_id
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return true;
end;
$function$
;


