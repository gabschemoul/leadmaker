-- 10/11/2026 : offre propre à une campagne (lm_campaigns.offer, null = celle du dossier), groupes fins (jusqu'à 20,
-- proposés après 3 fois plus de gardées, lm_campaigns.sort_groups_fine), jusqu'à 84 messages (4 versions × 21
-- onglets), copiés par « Dupliquer ». Compatible avec le code en ligne.

alter table "public"."lm_autopilots" drop constraint "lm_autopilots_messages_not_empty";

alter table "public"."lm_campaigns" add column "offer" text;

alter table "public"."lm_campaigns" add column "sort_groups_fine" boolean not null default false;

alter table "public"."lm_campaigns" add constraint "lm_campaigns_offer_length" CHECK (((offer IS NULL) OR (length(offer) <= 1000))) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_offer_length";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_messages_not_empty" CHECK (((cardinality(messages) >= 1) AND (cardinality(messages) <= 84))) not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_messages_not_empty";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_set_campaign_offer(p_campaign_id uuid, p_offer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.lm_campaigns c
     set offer = left(nullif(trim(p_offer), ''), 1000)
   where c.id = p_campaign_id and public.lm_member(c.account_id);

  if not found then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_check(p_campaign_id uuid, p_messages text[])
 RETURNS public.lm_campaigns
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns;
  v_names text[];
begin
  select c.* into v_campaign
    from public.lm_campaigns c
   where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_campaign.id is null then
    raise exception 'campaign not found' using errcode = 'P0001', hint = 'not_found';
  end if;

  if v_campaign.status = 'archived' then
    raise exception 'campaign archived' using errcode = 'P0001', hint = 'archived';
  end if;

  if not exists (select 1 from public.lm_sender_profiles s where s.space_id = v_campaign.space_id) then
    raise exception 'no sender profile' using errcode = 'P0001', hint = 'no_sender';
  end if;

  if not public.lm_templates_usable(v_campaign.templates) then
    raise exception 'campaign has no message' using errcode = 'P0001', hint = 'no_messages';
  end if;

  -- Noms des messages utilisables (même règle que le robot : texte non vide, « Message N » sans nom)
  select array_agg(coalesce(nullif(m ->> 'name', ''), 'Message ' || pos))
    into v_names
    from jsonb_array_elements(
           case when jsonb_typeof(v_campaign.templates) = 'array' then v_campaign.templates
                when jsonb_typeof(v_campaign.templates -> 'messages') = 'array' then v_campaign.templates -> 'messages'
                else '[]'::jsonb end) with ordinality as t(m, pos)
   where pos <= 84 and length(trim(coalesce(m ->> 'body', ''))) > 0;

  if p_messages is null or cardinality(p_messages) = 0 or cardinality(p_messages) > 84
     or not (p_messages <@ coalesce(v_names, '{}'::text[])) then
    raise exception 'unknown message' using errcode = 'P0001', hint = 'messages';
  end if;

  return v_campaign;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_campaign_message_names(p_campaign_id uuid, p_group text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with c as (
    select c.groups_choice,
           case when jsonb_typeof(c.templates) = 'array' then c.templates
                when jsonb_typeof(c.templates -> 'messages') = 'array' then c.templates -> 'messages'
                else '[]'::jsonb end as messages
      from public.lm_campaigns c where c.id = p_campaign_id
  ), m as (
    select coalesce(nullif(x ->> 'name', ''), 'Message ' || pos) as name, nullif(trim(x ->> 'group'), '') as grp, pos
      from c, jsonb_array_elements(c.messages) with ordinality as t(x, pos)
     where pos <= 84 and length(trim(coalesce(x ->> 'body', ''))) > 0
  )
  select case
           when (select groups_choice from c) = 'per_group' then
             coalesce((select array_agg(m.name order by m.pos) from m where m.grp = p_group),
                      (select array_agg(m.name order by m.pos) from m where m.grp is null),
                      (select array_agg(m.name order by m.pos) from m))
           else
             coalesce((select array_agg(m.name order by m.pos) from m where m.grp is null),
                      (select array_agg(m.name order by m.pos) from m))
         end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_duplicate_campaign(p_campaign_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source public.lm_campaigns%rowtype;
  v_id uuid;
begin
  select * into v_source from public.lm_campaigns where id = p_campaign_id;

  if v_source.id is null or not public.lm_member(v_source.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  -- offre propre à la campagne et groupes fins recopiés (10/11/2026)
  insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters, templates,
                                   daily_limit, auto_validation, sender_id, offer, sort_groups_fine)
  values (v_source.account_id, v_source.space_id, left(p_name, 255), v_source.country_code, v_source.targeting,
          v_source.filters - 'paused_reason', v_source.templates, v_source.daily_limit,
          v_source.auto_validation and public.lm_auto_validation_allowed(v_source.account_id), v_source.sender_id,
          v_source.offer, v_source.sort_groups_fine)
  returning id into v_id;

  return v_id;
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

    -- Groupes (§4.3) : assez de gardées et pas encore de groupes → une tâche de proposition (une par cible)
    -- groupes fins : 3 fois plus de gardées avant de proposer, pour voir aussi les sous-activités rares
    if (select c.sort_groups = '[]'::jsonb from public.lm_campaigns c where c.id = p_campaign_id)
       and (select count(*) from public.lm_campaign_prospects cp
             where cp.campaign_id = p_campaign_id and cp.sorted_version = p_version and cp.verdict = 'gardee')
           >= v_settings.sort_groups_after
              * (case when (select c.sort_groups_fine from public.lm_campaigns c where c.id = p_campaign_id) then 3 else 1 end) then
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
  -- 2 à 5 grands groupes, ou jusqu'à 20 groupes fins (lm_campaigns.sort_groups_fine)
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 2 and 20 then
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

CREATE OR REPLACE FUNCTION public.lm_start_sort(p_campaign_id uuid, p_target text, p_offer text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_target text := nullif(trim(p_target), '');
  v_count integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_target is null then
    raise exception 'empty target' using errcode = 'P0001', hint = 'sort_target_required';
  end if;

  if v_campaign.sort_target is distinct from v_target then
    -- Nouvelle cible : nouvelle version, prix remesuré sur le tri (l'estimation ne le fixe plus), compteurs
    -- de tri par activité remis à zéro
    update public.lm_campaigns
       set sort_target = v_target, sort_version = sort_version + 1, price_pending = true, estimate_id = null
     where id = p_campaign_id
     returning * into v_campaign;

    update public.lm_campaign_categories set sorted = 0, sorted_kept = 0 where campaign_id = p_campaign_id;
  end if;

  -- offre donnée : celle de la campagne (10/11/2026 ; avant, celle du dossier)
  if nullif(trim(p_offer), '') is not null then
    update public.lm_campaigns set offer = left(trim(p_offer), 1000) where id = v_campaign.id;
  end if;

  insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
  select v_campaign.account_id, 'sort',
         jsonb_build_object('campaign_id', v_campaign.id, 'prospect_id', cp.prospect_id,
                            'version', v_campaign.sort_version),
         'sort:' || v_campaign.id::text || ':' || cp.prospect_id::text || ':' || v_campaign.sort_version::text
    from (select cp.prospect_id
            from public.lm_campaign_prospects cp
           where cp.campaign_id = p_campaign_id
             and cp.sorted_version is distinct from v_campaign.sort_version
           order by md5(cp.prospect_id::text)
           limit p_limit) cp
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;



revoke all on function public.lm_set_campaign_offer(uuid, text) from public, anon;

grant execute on function public.lm_set_campaign_offer(uuid, text) to authenticated, service_role;
