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
             site_read_at = now()
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
    if (select c.sort_groups = '[]'::jsonb from public.lm_campaigns c where c.id = p_campaign_id)
       and (select count(*) from public.lm_campaign_prospects cp
             where cp.campaign_id = p_campaign_id and cp.sorted_version = p_version and cp.verdict = 'gardee')
           >= v_settings.sort_groups_after then
      insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
      select c.account_id, 'sort',
             jsonb_build_object('action', 'groups', 'campaign_id', c.id, 'version', p_version),
             'sortgroups:' || c.id::text || ':' || p_version::text
        from public.lm_campaigns c where c.id = p_campaign_id
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_set_sort_groups(p_campaign_id uuid, p_version integer, p_groups jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 2 and 5 then
    raise exception 'invalid groups' using errcode = 'P0001';
  end if;

  update public.lm_campaigns c set sort_groups = p_groups
   where c.id = p_campaign_id and c.sort_version = p_version and c.sort_groups = '[]'::jsonb;

  if not found then
    return 0;
  end if;

  -- Rangées « autre » avant que les groupes existent : à classer comme les autres
  update public.lm_campaign_prospects set group_key = null
   where campaign_id = p_campaign_id and group_key = 'autre';

  insert into public.lm_tasks (account_id, kind, payload, idempotency_key, priority)
  select cp.account_id, 'sort',
         jsonb_build_object('action', 'group', 'campaign_id', p_campaign_id, 'prospect_id', cp.prospect_id,
                            'version', p_version),
         'sortgroup:' || p_campaign_id::text || ':' || cp.prospect_id::text || ':' || p_version::text,
         -- avant le reste de la file de tri : l'encart des groupes s'affiche plus vite
         50
    from public.lm_campaign_prospects cp
   where cp.campaign_id = p_campaign_id and cp.sorted_version = p_version and cp.group_key is null
     and coalesce(cp.client_choice, cp.verdict) = 'gardee'
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;



-- Données : campagnes dont les groupes viennent d'être proposés (ex. « Agences digital », 9/11) alors que leurs
-- entreprises gardées avaient été rangées « autre » par défaut, faute de groupes : elles sont classées maintenant
-- (Claude Haiku, ~0,15 centime par entreprise, texte du site repris de l'annuaire). Seules celles triées AVANT la
-- proposition sont concernées ; « autre » rendu ensuite par le tri reste valable.
with g as (
  select c.id as campaign_id, c.sort_version, max(t.finished_at) as groups_at
    from public.lm_campaigns c
    join public.lm_tasks t on t.kind = 'sort' and t.payload ->> 'action' = 'groups'
                          and t.payload ->> 'campaign_id' = c.id::text and t.status = 'done'
   where c.sort_groups <> '[]'::jsonb
   group by c.id, c.sort_version
)
update public.lm_campaign_prospects cp set group_key = null
  from g
 where cp.campaign_id = g.campaign_id and cp.group_key = 'autre' and cp.sorted_at < g.groups_at;

insert into public.lm_tasks (account_id, kind, payload, idempotency_key, priority)
select cp.account_id, 'sort',
       jsonb_build_object('action', 'group', 'campaign_id', cp.campaign_id, 'prospect_id', cp.prospect_id,
                          'version', c.sort_version),
       'sortgroup:' || cp.campaign_id::text || ':' || cp.prospect_id::text || ':' || c.sort_version::text, 50
  from public.lm_campaign_prospects cp
  join public.lm_campaigns c on c.id = cp.campaign_id
 where c.sort_groups <> '[]'::jsonb and cp.sorted_version = c.sort_version and cp.group_key is null
   and coalesce(cp.client_choice, cp.verdict) = 'gardee'
on conflict (idempotency_key) do nothing;
