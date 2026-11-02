-- Places de recherche (lm_campaign_categories.in_flight) alignées sur les vraies tâches :
-- - lm_pause_campaign libère les places des recherches qu'elle annule ;
-- - lm_start_campaign recompte les places à la reprise (lm_recount_in_flight, nouvelle fonction,
--   aussi utilisée par workers/scripts/replan_discovery.py pour corriger les compteurs fantômes) ;
-- - lm_requeue_stale_tasks libère la place d'une recherche passée en échec définitif.
-- Sans ça, une pause laissait des centaines de places « occupées » que le planificateur (n°12)
-- prenait pour des explorations en cours.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_recount_in_flight(p_campaign_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fixed integer;
begin
  with real_tasks as (
    select t.payload ->> 'gcid' as gcid, count(*)::integer as cnt
      from public.lm_tasks t
     where t.kind = 'discovery' and t.status in ('queued', 'running')
       and t.payload ->> 'campaign_id' = p_campaign_id::text
     group by 1
  ), fixed as (
    update public.lm_campaign_categories cc
       set in_flight = coalesce(r.cnt, 0)
      from public.lm_campaign_categories c2
      left join real_tasks r on r.gcid = c2.gcid
     where c2.campaign_id = p_campaign_id and cc.campaign_id = c2.campaign_id and cc.gcid = c2.gcid
       and cc.in_flight <> coalesce(r.cnt, 0)
    returning 1
  )
  select count(*) into v_fixed from fixed;

  return v_fixed;
end;
$function$
;

revoke all on function public.lm_recount_in_flight(uuid) from public;

grant execute on function public.lm_recount_in_flight(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.lm_pause_campaign(p_campaign_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from public.lm_campaigns where id = p_campaign_id;

  if v_account_id is null
     or (auth.role() = 'authenticated' and not public.has_role_on_account(v_account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  update public.lm_campaigns
     set status = 'paused',
         filters = case when p_reason is null then filters else filters || jsonb_build_object('paused_reason', p_reason) end
   where id = p_campaign_id and status = 'running';

  -- Les recherches annulées libèrent leur place : in_flight ne compte que les tâches en file ou en cours
  with cancelled as (
    update public.lm_tasks set status = 'cancelled', finished_at = now()
     where kind = 'discovery' and status = 'queued' and payload ->> 'campaign_id' = p_campaign_id::text
    returning payload ->> 'gcid' as gcid
  )
  update public.lm_campaign_categories cc
     set in_flight = greatest(cc.in_flight - n.cnt, 0)
    from (select gcid, count(*)::integer as cnt from cancelled group by gcid) n
   where cc.campaign_id = p_campaign_id and cc.gcid = n.gcid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_requeue_stale_tasks(p_stale interval DEFAULT '00:15:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with stale as (
    update public.lm_tasks
       set status = case when attempts >= max_attempts then 'failed'::public.lm_task_status else 'queued'::public.lm_task_status end,
           error = coalesce(error, 'worker timeout'),
           worker_id = null,
           locked_at = null
     where status = 'running' and locked_at < now() - p_stale
    returning kind, status, payload
  ), released as (
    -- Une recherche Google Maps passée en échec définitif libère sa place dans la campagne
    update public.lm_campaign_categories cc
       set in_flight = greatest(cc.in_flight - f.cnt, 0)
      from (select (payload ->> 'campaign_id')::uuid as campaign_id, payload ->> 'gcid' as gcid, count(*)::integer as cnt
              from stale where kind = 'discovery' and status = 'failed' group by 1, 2) f
     where cc.campaign_id = f.campaign_id and cc.gcid = f.gcid
    returning 1
  )
  select count(*) into v_count from stale;

  return v_count;
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

  -- Premier lancement : on fige les villes et les catégories
  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    insert into public.lm_campaign_zones (campaign_id, idx, account_id, geoname_id, label, population,
                                          latitude, longitude, zoom)
      select p_campaign_id, (row_number() over (order by t.population desc, t.geoname_id, t.label)) - 1,
             v_campaign.account_id, t.geoname_id, t.label, t.population, t.latitude, t.longitude, t.zoom
        from public.lm_target_zones(v_campaign.country_code, v_campaign.targeting) t;

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


