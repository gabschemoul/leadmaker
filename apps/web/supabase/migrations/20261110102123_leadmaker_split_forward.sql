-- 10/11/2026 : campagne découpée par groupes qui continue de chercher : chaque nouvelle entreprise gardée rejoint la
-- campagne de son groupe (lm_forward_split_kept), sans nouveau tri ni débit. Compatible avec le code en ligne.

alter table "public"."lm_campaigns" add column "split_source_id" uuid;

CREATE INDEX ix_lm_campaigns_split_source_id ON public.lm_campaigns USING btree (split_source_id) WHERE (split_source_id IS NOT NULL);

alter table "public"."lm_campaigns" add constraint "lm_campaigns_split_source_id_fkey" FOREIGN KEY (split_source_id) REFERENCES public.lm_campaigns(id) ON DELETE SET NULL not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_split_source_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_forward_split_kept(p_campaign_id uuid, p_prospect_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and c.groups_choice = 'split') then
    return 0;
  end if;

  insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, verdict, group_key, reason,
                                            sorted_at, sorted_version, client_choice, decided_at, credits, paid_at, gcid)
  select ch.id, cp.prospect_id, cp.account_id, cp.space_id, coalesce(cp.verdict, 'gardee'), cp.group_key, cp.reason,
         cp.sorted_at, ch.sort_version, cp.client_choice, cp.decided_at, 0, cp.paid_at, cp.gcid
    from public.lm_campaign_prospects cp
    join public.lm_campaigns src on src.id = cp.campaign_id
    join public.lm_campaigns ch on ch.split_source_id = src.id and ch.sort_groups -> 0 ->> 'key' = cp.group_key
   where cp.campaign_id = p_campaign_id
     and (p_prospect_ids is null or cp.prospect_id = any (p_prospect_ids))
     and cp.paid_at is not null
     and coalesce(cp.client_choice, case when cp.sorted_version = src.sort_version then cp.verdict end) = 'gardee'
  on conflict (campaign_id, prospect_id) do nothing;

  get diagnostics v_count = row_count;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_choose_prospects(p_campaign_id uuid, p_prospect_ids uuid[], p_choice text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if p_choice not in ('gardee', 'ecartee') then
    raise exception 'invalid choice %', p_choice using errcode = 'P0001', hint = 'invalid_choice';
  end if;

  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  update public.lm_campaign_prospects cp
     set client_choice = p_choice, decided_at = now()
   where cp.campaign_id = p_campaign_id
     and cp.prospect_id = any (p_prospect_ids)
     and cp.client_choice is null
     and cp.verdict = 'a_verifier';

  get diagnostics v_count = row_count;

  if v_count > 0 and p_choice = 'gardee' then
    perform public.lm_measure_sort_price(p_campaign_id);
    perform public.lm_settle_kept(p_campaign_id, null);
    perform public.lm_forward_split_kept(p_campaign_id, p_prospect_ids);
  end if;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_enqueue_sort()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
  select c.account_id, 'sort',
         jsonb_build_object('campaign_id', c.id, 'prospect_id', new.prospect_id, 'version', c.sort_version),
         'sort:' || c.id::text || ':' || new.prospect_id::text || ':' || c.sort_version::text
    from public.lm_campaigns c
   where c.id = new.campaign_id and nullif(trim(c.sort_target), '') is not null
     -- entreprise arrivée déjà triée (campagne d'un groupe : l'avis est recopié) : rien à retrier
     and new.verdict is null
  on conflict (idempotency_key) do nothing;

  return null;
end;
$function$
;

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
    -- campagne déjà découpée par groupes : l'entreprise rejoint aussi la campagne de son groupe
    perform public.lm_forward_split_kept(p_campaign_id, array[p_prospect_id]);

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

CREATE OR REPLACE FUNCTION public.lm_finish_sort_group(p_campaign_id uuid, p_prospect_id uuid, p_version integer, p_group text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.lm_campaign_prospects cp set group_key = left(p_group, 60)
    from public.lm_campaigns c
   where cp.campaign_id = p_campaign_id and cp.prospect_id = p_prospect_id and c.id = cp.campaign_id
     and c.sort_version = p_version
     and (p_group = 'autre' or exists (select 1 from jsonb_array_elements(c.sort_groups) g where g ->> 'key' = p_group));

  if not found then
    return false;
  end if;

  -- campagne déjà découpée par groupes : l'entreprise rejoint aussi la campagne de son groupe
  perform public.lm_forward_split_kept(p_campaign_id, array[p_prospect_id]);

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_split_campaign_by_groups(p_campaign_id uuid)
 RETURNS TABLE(campaign_id uuid, group_key text, label text, companies integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source public.lm_campaigns%rowtype;
  v_group jsonb;
  v_id uuid;
  v_count integer;
begin
  select * into v_source from public.lm_campaigns c where c.id = p_campaign_id for update;

  if v_source.id is null or not public.lm_member(v_source.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_source.sort_groups = '[]'::jsonb then
    raise exception 'no groups' using errcode = 'P0001', hint = 'no_groups';
  end if;

  if v_source.groups_choice = 'split' then
    raise exception 'already split' using errcode = 'P0001', hint = 'already_split';
  end if;

  for v_group in select g from jsonb_array_elements(v_source.sort_groups) g
  loop
    v_id := public.lm_duplicate_campaign(p_campaign_id,
                                         left(v_source.name || ' · ' || coalesce(v_group ->> 'label', v_group ->> 'key'), 255));

    -- Liens posés AVANT la cible : le déclencheur ne remet rien en file de tri (l'avis est recopié)
    insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, verdict, group_key, reason,
                                              sorted_at, sorted_version, client_choice, decided_at, credits, paid_at, gcid)
    select v_id, cp.prospect_id, cp.account_id, cp.space_id, cp.verdict, cp.group_key, cp.reason,
           cp.sorted_at, 1, cp.client_choice, cp.decided_at, 0, cp.paid_at, cp.gcid
      from public.lm_campaign_prospects cp
     where cp.campaign_id = p_campaign_id and cp.group_key = v_group ->> 'key' and cp.paid_at is not null
       and coalesce(cp.client_choice, case when cp.sorted_version = v_source.sort_version then cp.verdict end) = 'gardee';

    get diagnostics v_count = row_count;

    update public.lm_campaigns
       set sort_target = v_source.sort_target, sort_version = 1, sort_groups = jsonb_build_array(v_group),
           groups_choice = 'split', price_pending = false, credits_per_prospect = v_source.credits_per_prospect,
           split_source_id = p_campaign_id
     where id = v_id;

    campaign_id := v_id;
    group_key := v_group ->> 'key';
    label := v_group ->> 'label';
    companies := v_count;
    return next;
  end loop;

  update public.lm_campaigns set groups_choice = 'split' where id = p_campaign_id;
end;
$function$
;



revoke all on function public.lm_forward_split_kept(uuid, uuid[]) from public, anon, authenticated;
