-- Planificateur des recherches : rattrapage des activités en retard (22/11/2026).
-- Une activité qui a plus de max(20, 5 % des villes) de retard sur la plus avancée de sa campagne passe avant
-- tout le reste. Avant, une activité sans prospect sur ses 2 premières recherches attendait la fin des autres
-- (« Trading card store » aux États-Unis : 2 recherches sur 4 472 pendant que « Game store » en était à 827).
-- Aucune signature changée : compatible avec le code de main.

create or replace function public.lm_schedule_discovery() returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
  v_lead integer;
  v_lag integer;
begin
  -- un seul planificateur à la fois
  if not pg_try_advisory_xact_lock(hashtext('lm_schedule_discovery')) then
    return 0;
  end if;

  select * into v_settings from public.lm_discovery_settings where id;

  -- Places d'exploration : la part réglée, arrondie, au moins une
  v_explore_slots := greatest(1, round(v_settings.explore_share * v_settings.tasks_per_campaign));

  for v_campaign in
    select c.id, c.account_id, c.country_code, nullif(trim(c.sort_target), '') is not null as sorted
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

    -- Retard toléré avant rattrapage : 5 % des villes, au moins 20
    v_lag := greatest(20, v_zone_count / 20);

    -- Recherches en cours sur des activités dont on n'a encore aucun résultat
    select coalesce(sum(in_flight), 0) into v_exploring
      from public.lm_campaign_categories where campaign_id = v_campaign.id and searches = 0;

    while v_slots > 0 loop
      v_explore := v_exploring < v_explore_slots;

      -- Position de l'activité la plus avancée (relue à chaque place : elle avance pendant la boucle)
      select max(next_zone_idx) into v_lead
        from public.lm_campaign_categories
       where campaign_id = v_campaign.id and not abandoned and not removed;

      select cc.gcid, cc.next_zone_idx, cat.label_en, (cc.searches + cc.in_flight = 0) as untried into v_pick
        from public.lm_campaign_categories cc
        join public.lm_categories cat using (gcid)
       where cc.campaign_id = v_campaign.id
         and not cc.abandoned and not cc.removed
         and cc.next_zone_idx < v_zone_count
       order by (cc.searches + cc.in_flight > 0 and v_lead - cc.next_zone_idx > v_lag) desc,
                -- entre activités en rattrapage : la plus en retard d'abord
                case when cc.searches + cc.in_flight > 0 and v_lead - cc.next_zone_idx > v_lag
                     then cc.next_zone_idx end nulls last,
                case
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
                  / (1 + cc.in_flight)
                  -- campagne triée par l'IA : part de gardées par le tri dans cette activité (lissée), pour
                  -- ne pas dépenser le proxy sur des activités hors cible (CDC §5.3)
                  * case when v_campaign.sorted then (cc.sorted_kept + 1)::numeric / (cc.sorted + 3) else 1 end desc,
                random()
       limit 1
       for update of cc skip locked;

      exit when v_pick.gcid is null;

      -- next_zone_idx : position dans l'ordre de passage (pos), pas l'identité de la zone (idx)
      select * into v_zone from public.lm_campaign_zones
       where campaign_id = v_campaign.id and pos = v_pick.next_zone_idx;

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
$$;

revoke all on function public.lm_schedule_discovery() from public;

grant execute on function public.lm_schedule_discovery() to service_role;
