-- Recherche d'une campagne (11/11/2026, retours de Gabriel) : toutes les recherches sont faites (plus d'abandon
-- d'une activité faute de résultats), plus de recherches d'essai pour une campagne triée (son prix vient du tri),
-- compteur « N recherches faites sur M » juste, activité abandonnée avant sans aucun prospect relancée sur les villes
-- ajoutées, et lm_campaign_search_phase (où en est le lancement). Compatible avec main : mêmes signatures.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_search_phase(p_campaign_id uuid)
 RETURNS TABLE(queued integer, running integer, ahead integer, resume_at timestamp with time zone, estimate_done integer, estimate_total integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_queued integer;
  v_running integer;
  v_ready integer;
  v_first record;
  v_ahead integer := 0;
  v_resume timestamptz;
  v_done integer;
  v_total integer;
begin
  select * into v_campaign from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_campaign.id is null then
    return;
  end if;

  select count(*) filter (where t.status = 'queued'),
         count(*) filter (where t.status = 'running'),
         count(*) filter (where t.status = 'queued' and t.run_after <= now()),
         min(t.run_after) filter (where t.status = 'queued' and t.run_after > now())
    into v_queued, v_running, v_ready, v_resume
    from public.lm_tasks t
   where t.kind = 'discovery' and t.payload ->> 'campaign_id' = p_campaign_id::text
     and t.status in ('queued', 'running');

  -- recherches passées avant la première des nôtres (même file, même ordre que lm_claim_task)
  if v_ready > 0 then
    select t.priority, t.created_at into v_first
      from public.lm_tasks t
     where t.kind = 'discovery' and t.payload ->> 'campaign_id' = p_campaign_id::text
       and t.status = 'queued' and t.run_after <= now()
     order by t.priority, t.created_at
     limit 1;

    select count(*)::integer into v_ahead
      from public.lm_tasks t
     where t.status = 'queued' and t.kind in ('discovery', 'estimate') and t.run_after <= now()
       and (t.priority, t.created_at) < (v_first.priority, v_first.created_at);
  end if;

  if v_campaign.price_pending and v_campaign.estimate_id is not null then
    select e.done_searches, e.sample_searches into v_done, v_total
      from public.lm_estimates e where e.id = v_campaign.estimate_id and e.status = 'running';
  end if;

  return query select v_queued, v_running, v_ahead, case when v_ready = 0 then v_resume end, v_done, v_total;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_campaign_progress(p_campaign_id uuid)
 RETURNS TABLE(zones integer, categories integer, searches_total bigint, searches_done bigint, in_flight bigint, abandoned integer, productive integer, prospects bigint, cards bigint, last_search_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_zones integer;
  -- positions des villes encore ciblées, triées (villes restantes d'une activité : width_bucket)
  v_positions integer[];
begin
  select c.account_id into v_account_id from public.lm_campaigns c where c.id = p_campaign_id;

  if v_account_id is null
     or (coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
         and not (public.has_role_on_account(v_account_id) and public.is_mfa_compliant())) then
    return;
  end if;

  select count(*)::integer, array_agg(z.pos order by z.pos) into v_zones, v_positions
    from public.lm_campaign_zones z where z.campaign_id = p_campaign_id and not z.removed;

  -- 11/11/2026 : recherches comptées sur les villes encore ciblées (une campagne passée de Villeurbanne à Lyon
  -- affichait « 10 sur 22 » sans rien chercher) ; une activité abandonnée (aucune entreprise ne correspond) ne
  -- compte plus que ses recherches faites (Barcelone « terminée » à « 10 sur 46 »).
  return query
  with removed_done as (
    select s.category, count(*)::integer as n
      from public.lm_searches s
      join public.lm_campaign_zones z on z.campaign_id = s.campaign_id and z.label = s.zone_key and z.removed
     where s.campaign_id = p_campaign_id
     group by s.category
  ), per_category as (
    select cc.*, least(greatest(cc.searches - coalesce(rd.n, 0), 0), v_zones) as done_active
      from public.lm_campaign_categories cc
      left join removed_done rd on rd.category = cc.gcid
     where cc.campaign_id = p_campaign_id
  )
  select v_zones,
         count(cc.gcid) filter (where not cc.removed)::integer,
         -- par activité : faites + en cours + villes ciblées restantes à partir de sa position (une activité qui a
         -- sauté des villes, ou abandonnée avant le 11/11/2026, ne les compte pas)
         coalesce(sum(case
                        when cc.abandoned then least(v_zones, cc.done_active + cc.in_flight)
                        else least(v_zones, cc.done_active + cc.in_flight
                                            + v_zones - coalesce(width_bucket(cc.next_zone_idx - 1, v_positions), 0))
                      end)
                    filter (where not cc.removed), 0)::bigint,
         coalesce(sum(cc.done_active) filter (where not cc.removed), 0)::bigint,
         coalesce(sum(cc.in_flight), 0),
         count(*) filter (where cc.abandoned and not cc.removed)::integer,
         count(*) filter (where cc.kept > 0 and not cc.removed)::integer,
         (select count(*) from public.lm_credit_ledger l
           where l.campaign_id = p_campaign_id and l.kind = 'discovery' and l.delta < 0),
         coalesce(sum(cc.cards), 0),
         (select max(s.created_at) from public.lm_searches s where s.campaign_id = p_campaign_id)
    from per_category cc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_search(p_campaign_id uuid, p_gcid text, p_zone_idx integer, p_cards integer, p_new integer, p_kept integer, p_duration_ms integer, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings public.lm_discovery_settings%rowtype;
  v_campaign public.lm_campaigns%rowtype;
  v_zone public.lm_campaign_zones%rowtype;
begin
  select * into v_settings from public.lm_discovery_settings where id;
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;
  select * into v_zone from public.lm_campaign_zones where campaign_id = p_campaign_id and idx = p_zone_idx;

  insert into public.lm_searches (account_id, campaign_id, country_code, category, zone_key, cards_seen, cards_new,
                                  cards_kept, duration_ms, error)
  values (v_campaign.account_id, p_campaign_id, v_campaign.country_code, p_gcid, v_zone.label, p_cards, p_new,
          p_kept, p_duration_ms, p_error)
  on conflict (campaign_id, category, zone_key, wave) do update set
    cards_seen = excluded.cards_seen, cards_new = excluded.cards_new, cards_kept = excluded.cards_kept,
    duration_ms = excluded.duration_ms, error = excluded.error;

  update public.lm_campaign_categories cc
     set in_flight = greatest(cc.in_flight - 1, 0),
         searches = cc.searches + 1,
         cards = cc.cards + p_cards,
         cards_new = cc.cards_new + p_new,
         kept = cc.kept + p_kept,
         -- première recherche : son résultat ; sinon moyenne glissante (sans valeur récente, on part de la
         -- moyenne de tout l'historique)
         recent_kept = case
           when cc.searches = 0 then p_kept
           else (1 - v_settings.recent_weight) * coalesce(cc.recent_kept, cc.kept::numeric / cc.searches)
                + v_settings.recent_weight * p_kept
         end,
         -- 11/11/2026 (Gabriel) : toutes les recherches sont faites, une activité n'est plus jamais abandonnée
         -- faute de résultats (Abbaye à Barcelone s'arrêtait après 10 recherches sur 46)
         abandoned = cc.abandoned
   where cc.campaign_id = p_campaign_id and cc.gcid = p_gcid;
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

  -- Rendement du tri par activité (le planificateur cherche d'abord les activités qui rapportent). 11/11/2026
  -- (Gabriel) : toutes les recherches sont faites, une activité n'est plus abandonnée pour rendement trop faible.
  if v_gcid is not null then
    update public.lm_campaign_categories cc
       set sorted = cc.sorted + 1,
           sorted_kept = cc.sorted_kept + (p_verdict = 'gardee')::integer
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

CREATE OR REPLACE FUNCTION public.lm_start_campaign(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_limit integer;
  v_running integer;
  v_balance integer;
  v_estimate_id uuid;
  v_credits integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_campaign.status = 'running' then
    return;
  end if;

  if v_campaign.status = 'archived' then
    raise exception 'campaign archived' using errcode = 'P0001', hint = 'archived';
  end if;

  select p.active_campaigns, c.discovery_balance + public.lm_pack_credits(c.account_id) into v_limit, v_balance
    from public.lm_account_credits c left join public.lm_plans p on p.id = c.plan_id
   where c.account_id = v_campaign.account_id;

  if v_balance is null or v_balance <= 0 then
    raise exception 'no discovery credits' using errcode = 'P0001', hint = 'no_credits';
  end if;

  -- un lancement à la fois par organisation : deux lancements simultanés ne dépassent pas le quota (audit A14)
  perform pg_advisory_xact_lock(hashtext('lm_start_campaign:' || v_campaign.account_id::text));

  select count(*) into v_running from public.lm_campaigns
   where account_id = v_campaign.account_id and status = 'running';

  if v_limit is not null and v_running >= v_limit then
    raise exception 'active campaign limit reached' using errcode = 'P0001', hint = 'campaign_limit';
  end if;

  -- Premier lancement : on fige les villes, les catégories et le tarif (crédits par prospect)
  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    -- Campagne avec une cible en mots : son prix se mesure sur les entreprises triées (lm_measure_sort_price).
    -- Plus de recherches d'essai pour elle (11/11/2026) : elles passaient avant ses vraies recherches dans la file
    -- des robots (1 à 2 minutes de « 0 recherche faite »), et leurs fiches étaient jetées puis recherchées à nouveau.
    if nullif(trim(v_campaign.sort_target), '') is null then
      -- Le tarif vient de l'estimation faite avec exactement ce ciblage et ces filtres (roadmap n°13).
      -- Audit A7 : la PLUS CHÈRE des 7 derniers jours (sinon relancer l'estimation jusqu'à tomber sur un
      -- échantillon favorable faisait baisser le tarif).
      select e.id, e.credits_per_prospect into v_estimate_id, v_credits
        from public.lm_estimates e
       where e.account_id = v_campaign.account_id and e.status = 'done'
         and e.created_at > now() - interval '7 days'
         and e.country_code = v_campaign.country_code
         and e.targeting = v_campaign.targeting
         and e.filters = (v_campaign.filters - 'paused_reason')
       order by e.credits_per_prospect desc nulls last, e.created_at desc
       limit 1;

      if v_estimate_id is not null then
        update public.lm_campaigns
           set credits_per_prospect = coalesce(v_credits, 1), estimate_id = v_estimate_id, price_pending = false
         where id = p_campaign_id;
      else
        -- 4/11/2026 : plus aucune attente avant le lancement. Sans estimation terminée, la campagne part tout
        -- de suite à 1 crédit par prospect ; la mesure (celle en cours, sinon une nouvelle) tourne en parallèle
        -- et fixe le tarif quand elle se termine (lm_record_estimate_search).
        select e.id into v_estimate_id
          from public.lm_estimates e
         where e.account_id = v_campaign.account_id and e.status = 'running'
           and e.country_code = v_campaign.country_code
           and e.targeting = v_campaign.targeting
           and e.filters = (v_campaign.filters - 'paused_reason')
         order by e.created_at desc
         limit 1
           for update;

        if v_estimate_id is null then
          v_estimate_id := public.lm_create_estimate(v_campaign.account_id, v_campaign.country_code,
                                                     v_campaign.targeting, v_campaign.filters - 'paused_reason');
        end if;

        update public.lm_campaigns
           set credits_per_prospect = 1, estimate_id = v_estimate_id, price_pending = true
         where id = p_campaign_id;
      end if;
    end if;

    -- Ordre de passage : chaque ville par son nom (des plus peuplées aux moins peuplées), puis les secteurs
    -- des grandes villes en alternant les villes
    insert into public.lm_campaign_zones (campaign_id, idx, pos, account_id, geoname_id, label, population,
                                          latitude, longitude, zoom)
      select p_campaign_id, z.rn - 1, z.rn - 1,
             v_campaign.account_id, z.geoname_id, z.label, z.population, z.latitude, z.longitude, z.zoom
        from (select t.*, row_number() over (
                       order by t.latitude is not null, coalesce(substring(t.label from ' · ([0-9]+)$')::integer, 0),
                                t.population desc, t.geoname_id, t.label) as rn
                from public.lm_target_zones(v_campaign.country_code, v_campaign.targeting) t) z;

    insert into public.lm_campaign_categories (campaign_id, gcid, account_id, is_generic)
      select p_campaign_id, t.gcid, v_campaign.account_id, t.is_generic
        from public.lm_target_categories(v_campaign.targeting) t;
  end if;

  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    raise exception 'no city matches the targeting' using errcode = 'P0001', hint = 'no_cities';
  end if;

  -- Reprise après une pause : les recherches annulées repartent
  update public.lm_tasks set status = 'queued', run_after = now(), finished_at = null, attempts = 0, error = null
   where kind = 'discovery' and status = 'cancelled' and payload ->> 'campaign_id' = p_campaign_id::text;

  -- Les places occupées repartent des vraies tâches en file ou en cours
  perform public.lm_recount_in_flight(p_campaign_id);

  update public.lm_campaigns
     set status = 'running', filters = filters - 'paused_reason'
   where id = p_campaign_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_update_campaign(p_campaign_id uuid, p_name text, p_country_code text, p_targeting jsonb, p_filters jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_launched boolean;
  v_next_idx integer;
  v_next_pos integer;
  v_zone_count integer;
  v_reprice boolean;
  v_estimate_id uuid;
  v_added_zones integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  v_launched := exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id);

  if v_launched and upper(p_country_code) <> v_campaign.country_code then
    raise exception 'country cannot change after launch' using errcode = 'P0001', hint = 'country_locked';
  end if;

  -- Audit A2 : après lancement, changer les filtres ou les activités change la difficulté, donc le tarif.
  -- Une nouvelle mesure est lancée ; d'ici là le tarif actuel s'applique, puis le tarif mesuré
  -- (lm_record_estimate_search). L'ancienne mesure éventuelle est abandonnée.
  -- 11/11/2026 : pas de recherches d'essai pour une campagne triée (son prix vient du tri IA)
  v_reprice := v_launched and nullif(trim(v_campaign.sort_target), '') is null and (
    (public.lm_normalize_filters(p_filters) - 'paused_reason') is distinct from (v_campaign.filters - 'paused_reason')
    or array(select t.gcid from public.lm_target_categories(p_targeting) t order by 1)
       is distinct from array(select t.gcid from public.lm_target_categories(v_campaign.targeting) t order by 1));

  update public.lm_campaigns
     set name = p_name,
         country_code = upper(p_country_code),
         targeting = p_targeting,
         -- la raison de pause est gérée par lm_pause_campaign, on la conserve
         filters = p_filters || case when filters ? 'paused_reason'
                                     then jsonb_build_object('paused_reason', filters -> 'paused_reason')
                                     else '{}'::jsonb end
   where id = p_campaign_id;

  if not v_launched then
    return v_campaign.status::text;
  end if;

  if v_reprice then
    if v_campaign.price_pending and v_campaign.estimate_id is not null then
      update public.lm_estimates set status = 'failed', finished_at = now()
       where id = v_campaign.estimate_id and status = 'running';
      update public.lm_tasks set status = 'cancelled', finished_at = now()
       where kind = 'estimate' and status = 'queued' and payload ->> 'estimate_id' = v_campaign.estimate_id::text;
    end if;

    v_estimate_id := public.lm_create_estimate(v_campaign.account_id, v_campaign.country_code, p_targeting,
                                               coalesce(p_filters, '{}') - 'paused_reason');

    update public.lm_campaigns set estimate_id = v_estimate_id, price_pending = true where id = p_campaign_id;
  end if;

  -- Villes : celles qui sortent du ciblage sont sautées, celles qui y reviennent reprennent
  update public.lm_campaign_zones z
     set removed = (z.geoname_id, z.label) not in (
           select t.geoname_id, t.label from public.lm_target_zones(v_campaign.country_code, p_targeting) t)
   where z.campaign_id = p_campaign_id;

  -- Nouvelles villes : à la fin de la file, dans le même ordre qu'au lancement (villes par leur nom, puis secteurs)
  select coalesce(max(idx), -1) + 1, coalesce(max(pos), -1) + 1 into v_next_idx, v_next_pos
    from public.lm_campaign_zones where campaign_id = p_campaign_id;

  insert into public.lm_campaign_zones (campaign_id, idx, pos, account_id, geoname_id, label, population,
                                        latitude, longitude, zoom)
    select p_campaign_id, v_next_idx + z.rn - 1, v_next_pos + z.rn - 1,
           v_campaign.account_id, z.geoname_id, z.label, z.population, z.latitude, z.longitude, z.zoom
      from (select t.*, row_number() over (
                     order by t.latitude is not null, coalesce(substring(t.label from ' · ([0-9]+)$')::integer, 0),
                              t.population desc, t.geoname_id, t.label) as rn
              from public.lm_target_zones(v_campaign.country_code, p_targeting) t
             where not exists (select 1 from public.lm_campaign_zones z
                                where z.campaign_id = p_campaign_id and z.geoname_id = t.geoname_id
                                  and z.label = t.label)) z;

  get diagnostics v_added_zones = row_count;

  -- Activités : même logique. Plus d'abandon depuis le 11/11/2026 ; une activité abandonnée avant, faute du moindre
  -- prospect (Abbaye à Villeurbanne, puis Lyon ajoutée), repart quand des villes sont ajoutées, directement sur ces
  -- nouvelles villes (pas sur les anciennes déjà jugées vides). Celles abandonnées avec des prospects restent.
  if v_added_zones > 0 then
    update public.lm_campaign_categories cc
       set abandoned = false, next_zone_idx = greatest(cc.next_zone_idx, v_next_pos)
     where cc.campaign_id = p_campaign_id and cc.abandoned and cc.kept = 0;
  end if;

  update public.lm_campaign_categories cc
     set removed = cc.gcid not in (select t.gcid from public.lm_target_categories(p_targeting) t)
   where cc.campaign_id = p_campaign_id;

  insert into public.lm_campaign_categories (campaign_id, gcid, account_id, is_generic)
    select p_campaign_id, t.gcid, v_campaign.account_id, t.is_generic
      from public.lm_target_categories(p_targeting) t
  on conflict (campaign_id, gcid) do nothing;

  -- Campagne terminée mais du travail est revenu : elle repasse en pause (« Reprendre » la relance)
  select count(*) into v_zone_count from public.lm_campaign_zones where campaign_id = p_campaign_id;

  if v_campaign.status = 'completed' and exists (
       select 1 from public.lm_campaign_categories cc
        where cc.campaign_id = p_campaign_id and not cc.abandoned and not cc.removed
          and exists (select 1 from public.lm_campaign_zones z
                       where z.campaign_id = p_campaign_id and not z.removed and z.pos >= cc.next_zone_idx)) then
    update public.lm_campaigns set status = 'paused' where id = p_campaign_id;
    return 'paused';
  end if;

  return v_campaign.status::text;
end;
$function$
;



-- Droits des fonctions (db diff ne les écrit pas)
revoke all on function public.lm_campaign_search_phase(uuid) from public;
grant execute on function public.lm_campaign_search_phase(uuid) to authenticated, service_role;
