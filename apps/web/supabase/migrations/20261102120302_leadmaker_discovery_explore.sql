-- Roadmap n°12 (validé par Gabriel le 2/11/2026) : choisir les activités qui rapportent, abandonner vite les autres.
-- - lm_discovery_settings : explore_share (part des places réservée aux activités jamais essayées, 1/4)
--   et abandon_zero_after (une activité sans aucun prospect après 5 recherches est abandonnée).
-- - lm_schedule_discovery : exploration limitée + exploitation des activités au meilleur rendement.
-- - lm_finish_search : nouvelle règle d'abandon (l'ancienne, 5 % après 40 recherches, est conservée).
-- - lm_campaign_progress : colonne `productive` (activités ayant rapporté au moins un prospect) ;
--   le type de retour change, d'où le drop puis la recréation avec ses droits.
drop function if exists "public"."lm_campaign_progress"(p_campaign_id uuid);

alter table "public"."lm_discovery_settings" add column "abandon_zero_after" integer not null default 5;

alter table "public"."lm_discovery_settings" add column "explore_share" numeric(4,3) not null default 0.25;

alter table "public"."lm_discovery_settings" add constraint "lm_discovery_settings_explore" CHECK (((explore_share >= (0)::numeric) AND (explore_share <= (1)::numeric) AND (abandon_zero_after > 0))) not valid;

alter table "public"."lm_discovery_settings" validate constraint "lm_discovery_settings_explore";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_progress(p_campaign_id uuid)
 RETURNS TABLE(zones integer, categories integer, searches_total bigint, searches_done bigint, in_flight bigint, abandoned integer, productive integer, prospects bigint, cards bigint, last_search_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (select count(*)::integer from public.lm_campaign_zones z where z.campaign_id = p_campaign_id and not z.removed),
         count(cc.gcid) filter (where not cc.removed)::integer,
         (select count(*) from public.lm_campaign_zones z where z.campaign_id = p_campaign_id and not z.removed)
           * count(cc.gcid) filter (where not cc.removed),
         coalesce(sum(cc.searches), 0),
         coalesce(sum(cc.in_flight), 0),
         count(*) filter (where cc.abandoned and not cc.removed)::integer,
         count(*) filter (where cc.kept > 0 and not cc.removed)::integer,
         (select count(*) from public.lm_credit_ledger l where l.campaign_id = p_campaign_id and l.kind = 'discovery' and l.delta < 0),
         coalesce(sum(cc.cards), 0),
         (select max(s.created_at) from public.lm_searches s where s.campaign_id = p_campaign_id)
    from public.lm_campaign_categories cc
   where cc.campaign_id = p_campaign_id;
$function$
;

revoke all on function public.lm_campaign_progress(uuid) from public;

grant execute on function public.lm_campaign_progress(uuid) to authenticated, service_role;

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
         abandoned = cc.abandoned
           or (cc.kept + p_kept = 0 and cc.searches + 1 >= v_settings.abandon_zero_after)
           or (cc.searches + 1 >= v_settings.min_searches
               and (cc.kept + p_kept) < v_settings.min_rate * (cc.searches + 1))
   where cc.campaign_id = p_campaign_id and cc.gcid = p_gcid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_schedule_discovery()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings public.lm_discovery_settings%rowtype;
  v_campaign record;
  v_pick record;
  v_zone public.lm_campaign_zones%rowtype;
  v_created integer := 0;
  v_slots integer;
  v_explore_slots integer;
  v_exploring integer;
  v_explore boolean;
  v_zone_count integer;
  v_inserted integer;
begin
  -- un seul planificateur à la fois
  if not pg_try_advisory_xact_lock(hashtext('lm_schedule_discovery')) then
    return 0;
  end if;

  select * into v_settings from public.lm_discovery_settings where id;

  -- Places d'exploration : la part réglée, arrondie, au moins une
  v_explore_slots := greatest(1, round(v_settings.explore_share * v_settings.tasks_per_campaign));

  for v_campaign in
    select c.id, c.account_id, c.country_code
      from public.lm_campaigns c
     where c.status = 'running'
  loop
    select v_settings.tasks_per_campaign - count(*) into v_slots
      from public.lm_tasks t
     where t.kind = 'discovery' and t.status in ('queued', 'running')
       and t.payload ->> 'campaign_id' = v_campaign.id::text;

    select count(*) into v_zone_count from public.lm_campaign_zones where campaign_id = v_campaign.id;

    -- Recherches en cours sur des activités dont on n'a encore aucun résultat
    select coalesce(sum(in_flight), 0) into v_exploring
      from public.lm_campaign_categories where campaign_id = v_campaign.id and searches = 0;

    while v_slots > 0 loop
      v_explore := v_exploring < v_explore_slots;

      select cc.gcid, cc.next_zone_idx, cat.label_en, (cc.searches + cc.in_flight = 0) as untried into v_pick
        from public.lm_campaign_categories cc
        join public.lm_categories cat using (gcid)
       where cc.campaign_id = v_campaign.id
         and not cc.abandoned and not cc.removed
         and cc.next_zone_idx < v_zone_count
       order by case
                  when cc.searches + cc.in_flight = 0 then (case when v_explore then 0 else 1 end)
                  when cc.kept > 0 then (case when v_explore then 1 else 0 end)
                  else 2
                end,
                (cc.searches + cc.in_flight = 0 and cc.is_generic) desc,
                cc.kept::numeric / (cc.searches + cc.in_flight + v_settings.prior) desc,
                random()
       limit 1
       for update of cc skip locked;

      exit when v_pick.gcid is null;

      select * into v_zone from public.lm_campaign_zones
       where campaign_id = v_campaign.id and idx = v_pick.next_zone_idx;

      -- Ville retirée après le lancement : on passe à la suivante sans rien planifier
      if v_zone.removed then
        update public.lm_campaign_categories set next_zone_idx = next_zone_idx + 1
         where campaign_id = v_campaign.id and gcid = v_pick.gcid;
        v_pick := null;
        continue;
      end if;

      insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
      values (v_campaign.account_id, 'discovery',
              jsonb_build_object('campaign_id', v_campaign.id, 'gcid', v_pick.gcid, 'zone_idx', v_zone.idx,
                                 'category', v_pick.label_en, 'zone', v_zone.label,
                                 'country_code', v_campaign.country_code,
                                 'latitude', v_zone.latitude, 'longitude', v_zone.longitude, 'zoom', v_zone.zoom,
                                 'geoname_id', v_zone.geoname_id,
                                 'city', (select c.name from public.lm_geo_cities c where c.geoname_id = v_zone.geoname_id),
                                 'query', case when v_zone.latitude is null
                                               then v_pick.label_en || ' in ' || v_zone.label
                                               else v_pick.label_en end),
              'discovery:' || v_campaign.id || ':' || v_pick.gcid || ':' || v_zone.idx)
      on conflict (idempotency_key) do nothing;

      get diagnostics v_inserted = row_count;

      update public.lm_campaign_categories
         set next_zone_idx = next_zone_idx + 1, in_flight = in_flight + v_inserted
       where campaign_id = v_campaign.id and gcid = v_pick.gcid;

      if v_pick.untried then
        v_exploring := v_exploring + v_inserted;
      end if;

      v_created := v_created + v_inserted;
      v_slots := v_slots - v_inserted;
      v_pick := null;
    end loop;

    -- Plus rien à chercher et plus rien en cours : campagne terminée
    if not exists (
      select 1 from public.lm_campaign_categories cc
       where cc.campaign_id = v_campaign.id
         and (cc.in_flight > 0 or (not cc.abandoned and not cc.removed and cc.next_zone_idx < v_zone_count))
    ) then
      update public.lm_campaigns set status = 'completed' where id = v_campaign.id;
    end if;
  end loop;

  return v_created;
end;
$function$
;


