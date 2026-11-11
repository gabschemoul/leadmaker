-- Recherche d'une campagne (11/11/2026, retours de Gabriel) : compteur « N recherches faites sur M » juste
-- (villes retirées, activités abandonnées), activité sans aucun prospect qui repart sur les villes ajoutées, et
-- lm_campaign_search_phase (où en est le lancement). Compatible avec main : colonnes avec défaut, mêmes signatures.

alter table "public"."lm_campaign_categories" add column "abandon_base_kept" integer not null default 0;

alter table "public"."lm_campaign_categories" add column "abandon_base_searches" integer not null default 0;

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
begin
  select c.account_id into v_account_id from public.lm_campaigns c where c.id = p_campaign_id;

  if v_account_id is null
     or (coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
         and not (public.has_role_on_account(v_account_id) and public.is_mfa_compliant())) then
    return;
  end if;

  select count(*)::integer into v_zones
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
         -- activité relancée sur des villes ajoutées (abandon_base_searches > 0) : elle a sauté les anciennes
         -- villes jugées vides, son total = faites + en cours + villes restantes à partir de sa position
         coalesce(sum(case
                        when cc.abandoned then least(v_zones, cc.done_active + cc.in_flight)
                        when cc.abandon_base_searches > 0 then
                          least(v_zones, cc.done_active + cc.in_flight
                                         + (select count(*) from public.lm_campaign_zones z
                                             where z.campaign_id = p_campaign_id and not z.removed
                                               and z.pos >= cc.next_zone_idx))
                        else v_zones end)
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
         -- compté depuis la dernière relance par ajout de villes (abandon_base_*)
         abandoned = cc.abandoned
           or (cc.kept - cc.abandon_base_kept + p_kept = 0
               and cc.searches - cc.abandon_base_searches + 1 >= v_settings.abandon_zero_after)
           or (cc.searches - cc.abandon_base_searches + 1 >= v_settings.min_searches
               and (cc.kept - cc.abandon_base_kept + p_kept)
                   < v_settings.min_rate * (cc.searches - cc.abandon_base_searches + 1))
   where cc.campaign_id = p_campaign_id and cc.gcid = p_gcid;
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
  v_reprice := v_launched and (
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

  -- Activités : même logique. Une activité abandonnée faute du moindre prospect (Abbaye à Villeurbanne, puis Lyon
  -- ajoutée, 11/11/2026) repart quand des villes sont ajoutées, directement sur ces nouvelles villes (pas sur les
  -- anciennes déjà jugées vides) ; son abandon se compte depuis maintenant. Celles abandonnées pour faible
  -- rendement ou écartées par le tri (elles ont des prospects) restent abandonnées : pas de proxy dépensé à nouveau.
  if v_added_zones > 0 then
    update public.lm_campaign_categories cc
       set abandoned = false, abandon_base_searches = cc.searches, abandon_base_kept = cc.kept,
           next_zone_idx = greatest(cc.next_zone_idx, v_next_pos)
     where cc.campaign_id = p_campaign_id and cc.abandoned and cc.kept = cc.abandon_base_kept and cc.sorted = 0;
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
