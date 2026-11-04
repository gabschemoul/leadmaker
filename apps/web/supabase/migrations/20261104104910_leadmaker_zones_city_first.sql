-- 4/11/2026 : chaque activité cherche d'abord chaque ville par son nom (« Hotel in Brussels, Belgium »), comme
-- l'ancien bot, et seulement ensuite les secteurs des grandes villes, en alternant les villes. Avant, elle
-- faisait les 37 secteurs de Bruxelles avant la moindre autre ville (0,44 prospect par recherche à Bruxelles,
-- 4 à 5 ailleurs) : « review cleaner » a passé 99 % de sa nuit dans Bruxelles.
--
-- idx reste l'identité d'une zone (il est dans les tâches et dans leur clé d'unicité) ; pos est l'ordre de
-- passage, et next_zone_idx devient une position dans cet ordre.

alter table "public"."lm_campaign_zones" add column "pos" integer;

-- Campagnes en cours ou en pause : une recherche par nom pour chaque grande ville (jusqu'ici seulement
-- découpée en secteurs). Retirée du ciblage si tous ses secteurs l'étaient. Les campagnes terminées ne
-- changent pas ; une modification de leur ciblage ajoutera ces zones (lm_update_campaign).
insert into public.lm_campaign_zones (campaign_id, idx, account_id, geoname_id, label, population, removed)
select z.campaign_id,
       m.max_idx + row_number() over (partition by z.campaign_id order by max(z.population) desc, z.geoname_id),
       min(z.account_id::text)::uuid, z.geoname_id, regexp_replace(min(z.label), ' · [0-9]+$', ''),
       max(z.population), bool_and(z.removed)
  from public.lm_campaign_zones z
  join public.lm_campaigns c on c.id = z.campaign_id and c.status in ('running', 'paused')
  join (select campaign_id, max(idx) as max_idx from public.lm_campaign_zones group by campaign_id) m
    on m.campaign_id = z.campaign_id
 where z.latitude is not null
   and not exists (select 1 from public.lm_campaign_zones x
                    where x.campaign_id = z.campaign_id and x.geoname_id = z.geoname_id and x.latitude is null)
 group by z.campaign_id, z.geoname_id, m.max_idx;

-- Ordre de passage de toutes les zones (même règle que lm_start_campaign)
update public.lm_campaign_zones z
   set pos = o.rn - 1
  from (select campaign_id, idx,
               row_number() over (
                 partition by campaign_id
                 order by latitude is not null, coalesce(substring(label from ' · ([0-9]+)$')::integer, 0),
                          population desc, geoname_id, label) as rn
          from public.lm_campaign_zones) o
 where o.campaign_id = z.campaign_id and o.idx = z.idx;

-- Avant, une activité parcourait les zones dans l'ordre de idx : celles sous son curseur sont faites. Son
-- nouveau curseur est la première position parmi les zones qui restaient (idx >= ancien curseur). Les zones
-- déjà faites qu'elle croisera plus loin sont sautées par le planificateur (tâche déjà existante : clé
-- d'unicité). Sans zone restante, le curseur passe au bout.
-- (idx est continu de 0 à n-1 : lancement puis ajouts en fin de file. Le minimum « en suffixe » donne, pour
-- chaque idx, la première position parmi les zones d'idx supérieur ou égal.)
update public.lm_campaign_categories cc
   set next_zone_idx = s.first_pos
  from (select campaign_id, idx,
               min(pos) over (partition by campaign_id order by idx desc) as first_pos
          from public.lm_campaign_zones) s
 where s.campaign_id = cc.campaign_id and s.idx = cc.next_zone_idx;
-- Curseur au bout (aucune zone d'idx supérieur) : il reste au bout, le nombre de zones n'a pas changé
-- pour ces campagnes-là (terminées, ou toutes leurs zones faites sans grande ville à ajouter).

alter table "public"."lm_campaign_zones" alter column "pos" set not null;

CREATE UNIQUE INDEX lm_campaign_zones_pos_unique ON public.lm_campaign_zones USING btree (campaign_id, pos);

alter table "public"."lm_campaign_zones" add constraint "lm_campaign_zones_pos_unique" UNIQUE using index "lm_campaign_zones_pos_unique";

set check_function_bodies = off;

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

  if v_campaign.id is null or not public.has_role_on_account(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_campaign.status = 'running' then
    return;
  end if;

  select p.active_campaigns, c.discovery_balance into v_limit, v_balance
    from public.lm_account_credits c left join public.lm_plans p on p.id = c.plan_id
   where c.account_id = v_campaign.account_id;

  if v_balance is null or v_balance <= 0 then
    raise exception 'no discovery credits' using errcode = 'P0001', hint = 'no_credits';
  end if;

  select count(*) into v_running from public.lm_campaigns
   where account_id = v_campaign.account_id and status = 'running';

  if v_limit is not null and v_running >= v_limit then
    raise exception 'active campaign limit reached' using errcode = 'P0001', hint = 'campaign_limit';
  end if;

  -- Premier lancement : on fige les villes, les catégories et le tarif (crédits par prospect)
  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    -- Le tarif vient de l'estimation faite avec exactement ce ciblage et ces filtres (roadmap n°13).
    -- Sans estimation, la campagne ne part pas : l'application en lance une (lm_request_campaign_estimate).
    select e.id, e.credits_per_prospect into v_estimate_id, v_credits
      from public.lm_estimates e
     where e.account_id = v_campaign.account_id and e.status = 'done'
       and e.country_code = v_campaign.country_code
       and e.targeting = v_campaign.targeting
       and e.filters = (v_campaign.filters - 'paused_reason')
     order by e.created_at desc
     limit 1;

    if v_estimate_id is null then
      raise exception 'estimate required before launch' using errcode = 'P0001', hint = 'estimate_required';
    end if;

    update public.lm_campaigns
       set credits_per_prospect = coalesce(v_credits, 1), estimate_id = v_estimate_id
     where id = p_campaign_id;

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

CREATE OR REPLACE FUNCTION public.lm_target_zones(p_country_code text, p_targeting jsonb)
 RETURNS TABLE(geoname_id integer, label text, population integer, latitude double precision, longitude double precision, zoom smallint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select t.geoname_id, t.label, t.population, null::double precision, null::double precision, null::smallint
    from public.lm_target_cities(p_country_code, p_targeting) t
  union all
  select t.geoname_id,
         t.label || ' · ' || row_number() over (partition by t.geoname_id order by g.ord),
         t.population, g.latitude, g.longitude, 15::smallint
    from public.lm_target_cities(p_country_code, p_targeting) t
    join public.lm_geo_cities c on c.geoname_id = t.geoname_id
    cross join lateral (
      select gg.latitude, gg.longitude, row_number() over () as ord
        from public.lm_city_grid(c.latitude, c.longitude, t.population) gg
    ) g
   where t.population >= 50000;
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
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null or not public.has_role_on_account(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  v_launched := exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id);

  if v_launched and upper(p_country_code) <> v_campaign.country_code then
    raise exception 'country cannot change after launch' using errcode = 'P0001', hint = 'country_locked';
  end if;

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

  -- Activités : même logique (une activité abandonnée pour faible rendement le reste)
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


