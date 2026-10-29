set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_request_estimate(p_account_id uuid, p_country_code text, p_targeting jsonb, p_filters jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_total bigint;
  v_zones bigint;
  v_categories bigint;
  v_mode text;
  v_sample integer := 30;
begin
  if not public.has_role_on_account(p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  -- Une seule estimation à la fois par organisation : la précédente est abandonnée
  update public.lm_estimates set status = 'failed', finished_at = now()
   where account_id = p_account_id and status = 'running';

  update public.lm_tasks set status = 'cancelled', finished_at = now()
   where kind = 'estimate' and status = 'queued' and account_id = p_account_id;

  select count(*) into v_zones from public.lm_target_zones(p_country_code, p_targeting);
  select count(*) into v_categories from public.lm_target_categories(p_targeting);
  v_total := v_zones * v_categories;

  if v_total = 0 then
    raise exception 'nothing to estimate' using errcode = 'P0001', hint = 'no_cities';
  end if;

  v_mode := case when v_total <= v_sample then 'exact' else 'sample' end;

  insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, total_searches, sample_searches)
  values (p_account_id, upper(p_country_code), p_targeting, coalesce(p_filters, '{}'), v_mode, v_total,
          least(v_total, v_sample))
  returning id into v_id;

  insert into public.lm_tasks (account_id, kind, payload, idempotency_key, priority)
  select p_account_id, 'estimate',
         jsonb_build_object('estimate_id', v_id, 'country_code', upper(p_country_code),
                            'latitude', s.latitude, 'longitude', s.longitude, 'zoom', s.zoom,
                            'geoname_id', s.geoname_id, 'category', s.label_en,
                            'is_grid', s.latitude is not null,
                            'query', case when s.latitude is null then s.label_en || ' in ' || s.label else s.label_en end),
         'estimate:' || v_id || ':' || row_number() over (),
         10
    from (
      select z.geoname_id, z.label, z.latitude, z.longitude, z.zoom, cat.label_en
        from public.lm_target_zones(p_country_code, p_targeting) z
       cross join public.lm_target_categories(p_targeting) c
        join public.lm_categories cat on cat.gcid = c.gcid
       where v_mode = 'exact'
      union all
      select z.geoname_id, z.label, z.latitude, z.longitude, z.zoom,
             (select cat.label_en from public.lm_target_categories(p_targeting) c
                join public.lm_categories cat on cat.gcid = c.gcid
               where z.label is not null
               order by random() limit 1)
        from (select * from public.lm_target_zones(p_country_code, p_targeting) order by random() limit v_sample) z
       where v_mode = 'sample'
    ) s;

  return v_id;
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
         and not cc.abandoned
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

      insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
      values (v_campaign.account_id, 'discovery',
              jsonb_build_object('campaign_id', v_campaign.id, 'gcid', v_pick.gcid, 'zone_idx', v_zone.idx,
                                 'category', v_pick.label_en, 'zone', v_zone.label,
                                 'country_code', v_campaign.country_code,
                                 'latitude', v_zone.latitude, 'longitude', v_zone.longitude, 'zoom', v_zone.zoom,
                                 'geoname_id', v_zone.geoname_id,
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
       where cc.campaign_id = v_campaign.id and (cc.in_flight > 0 or (not cc.abandoned and cc.next_zone_idx < v_zone_count))
    ) then
      update public.lm_campaigns set status = 'completed' where id = v_campaign.id;
    end if;
  end loop;

  return v_created;
end;
$function$
;


