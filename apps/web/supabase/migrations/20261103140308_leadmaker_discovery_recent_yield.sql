alter table "public"."lm_campaign_categories" add column "recent_kept" numeric;

alter table "public"."lm_discovery_settings" add column "recent_weight" numeric(4,3) not null default 0.3;

alter table "public"."lm_discovery_settings" add constraint "lm_discovery_settings_recent_weight" CHECK (((recent_weight > (0)::numeric) AND (recent_weight <= (1)::numeric))) not valid;

alter table "public"."lm_discovery_settings" validate constraint "lm_discovery_settings_recent_weight";

-- Départ du rendement récent des activités déjà cherchées : la même moyenne glissante que lm_finish_search,
-- rejouée sur leur journal de recherches (lm_searches, de la plus ancienne à la plus récente) : la plus ancienne
-- pèse (1 - poids)^(n - 1), chacune des suivantes poids × (1 - poids)^(rang depuis la plus récente).
with ranked as (
  select s.campaign_id, s.category, s.cards_kept,
         row_number() over w_new - 1 as rn_new,
         count(*) over (partition by s.campaign_id, s.category) as n
    from public.lm_searches s
  window w_new as (partition by s.campaign_id, s.category order by s.created_at desc, s.id desc)
),
weighted as (
  select r.campaign_id, r.category,
         sum(r.cards_kept * case
               when r.rn_new = r.n - 1 then power(1 - st.recent_weight, r.n - 1)
               else st.recent_weight * power(1 - st.recent_weight, r.rn_new)
             end) as recent_kept
    from ranked r
    cross join public.lm_discovery_settings st
   where st.id
   group by r.campaign_id, r.category
)
update public.lm_campaign_categories cc
   set recent_kept = round(w.recent_kept, 4)
  from weighted w
 where cc.campaign_id = w.campaign_id and cc.gcid = w.category and cc.searches > 0;

-- Sans journal (ne devrait pas arriver) : la moyenne de tout l'historique
update public.lm_campaign_categories
   set recent_kept = kept::numeric / searches
 where searches > 0 and recent_kept is null;

set check_function_bodies = off;

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
    if public.lm_proxy_over_budget(v_campaign.account_id) then
      -- Budget de proxy du mois dépassé (roadmap n°14) : le compte entier n'a plus qu'une poignée de
      -- recherches à la fois, toutes campagnes confondues. Invisible pour le client, la recherche ralentit.
      select v_settings.over_budget_tasks_per_account - count(*) into v_slots
        from public.lm_tasks t
       where t.kind = 'discovery' and t.status in ('queued', 'running')
         and t.account_id = v_campaign.account_id;
    else
      select v_settings.tasks_per_campaign - count(*) into v_slots
        from public.lm_tasks t
       where t.kind = 'discovery' and t.status in ('queued', 'running')
         and t.payload ->> 'campaign_id' = v_campaign.id::text;
    end if;

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
                -- prospects récents par Mo de proxy attendu par recherche (trafic mesuré de l'activité,
                -- sinon le trafic par défaut), partagés entre les recherches déjà en cours
                coalesce(cc.recent_kept, cc.kept::numeric / nullif(cc.searches, 0), 0)
                  / case
                      when cc.proxy_bytes > 0 and cc.searches > 0 then cc.proxy_bytes / 1e6 / cc.searches
                      else v_settings.default_search_mb
                    end
                  / (1 + cc.in_flight) desc,
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


