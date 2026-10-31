-- Modification d'une campagne après le lancement : villes / activités ajoutées ou retirées.
alter table public.lm_campaign_zones add column if not exists removed boolean not null default false;
alter table public.lm_campaign_categories add column if not exists removed boolean not null default false;

comment on table public.lm_campaign_zones is 'Zones (villes) parcourues par une campagne, fixées au lancement puis complétées à chaque modification du ciblage';

create or replace function public.lm_schedule_discovery() returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_settings public.lm_discovery_settings%rowtype;
  v_campaign record;
  v_mean numeric;
  v_pick record;
  v_zone public.lm_campaign_zones%rowtype;
  v_created integer := 0;
  v_slots integer;
  v_zone_count integer;
  v_inserted integer;
begin
  -- un seul planificateur à la fois
  if not pg_try_advisory_xact_lock(hashtext('lm_schedule_discovery')) then
    return 0;
  end if;

  select * into v_settings from public.lm_discovery_settings where id;

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

    select coalesce(sum(kept)::numeric / nullif(sum(searches), 0), v_settings.default_rate) into v_mean
      from public.lm_campaign_categories where campaign_id = v_campaign.id;

    while v_slots > 0 loop
      select cc.gcid, cc.next_zone_idx, cat.label_en into v_pick
        from public.lm_campaign_categories cc
        join public.lm_categories cat using (gcid)
       where cc.campaign_id = v_campaign.id
         and not cc.abandoned and not cc.removed
         and cc.next_zone_idx < v_zone_count
       order by (cc.searches + cc.in_flight > 0),
                cc.is_generic desc,
                (cc.kept + v_settings.prior * v_mean) / (cc.searches + v_settings.prior) desc,
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

create or replace function public.lm_campaign_progress(p_campaign_id uuid)
returns table (zones integer, categories integer, searches_total bigint, searches_done bigint, in_flight bigint,
               abandoned integer, prospects bigint, cards bigint, last_search_at timestamptz)
set search_path = ''
language sql
stable
as $$
  select (select count(*)::integer from public.lm_campaign_zones z where z.campaign_id = p_campaign_id and not z.removed),
         count(cc.gcid) filter (where not cc.removed)::integer,
         (select count(*) from public.lm_campaign_zones z where z.campaign_id = p_campaign_id and not z.removed)
           * count(cc.gcid) filter (where not cc.removed),
         coalesce(sum(cc.searches), 0),
         coalesce(sum(cc.in_flight), 0),
         count(*) filter (where cc.abandoned and not cc.removed)::integer,
         (select count(*) from public.lm_credit_ledger l where l.campaign_id = p_campaign_id and l.kind = 'discovery' and l.delta < 0),
         coalesce(sum(cc.cards), 0),
         (select max(s.created_at) from public.lm_searches s where s.campaign_id = p_campaign_id)
    from public.lm_campaign_categories cc
   where cc.campaign_id = p_campaign_id;
$$;

create or replace function public.lm_update_campaign(
  p_campaign_id uuid, p_name text, p_country_code text, p_targeting jsonb, p_filters jsonb
) returns text
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_launched boolean;
  v_next_idx integer;
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

  -- Nouvelles villes : à la fin de la file, des plus peuplées aux moins peuplées
  select coalesce(max(idx), -1) + 1 into v_next_idx from public.lm_campaign_zones where campaign_id = p_campaign_id;

  insert into public.lm_campaign_zones (campaign_id, idx, account_id, geoname_id, label, population, latitude, longitude, zoom)
    select p_campaign_id, v_next_idx + (row_number() over (order by t.population desc, t.geoname_id, t.label)) - 1,
           v_campaign.account_id, t.geoname_id, t.label, t.population, t.latitude, t.longitude, t.zoom
      from public.lm_target_zones(v_campaign.country_code, p_targeting) t
     where not exists (select 1 from public.lm_campaign_zones z
                        where z.campaign_id = p_campaign_id and z.geoname_id = t.geoname_id and z.label = t.label);

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
                       where z.campaign_id = p_campaign_id and not z.removed and z.idx >= cc.next_zone_idx)) then
    update public.lm_campaigns set status = 'paused' where id = p_campaign_id;
    return 'paused';
  end if;

  return v_campaign.status::text;
end;
$$;

revoke all on function public.lm_update_campaign(uuid, text, text, jsonb, jsonb) from public;

grant execute on function public.lm_update_campaign(uuid, text, text, jsonb, jsonb) to authenticated;
