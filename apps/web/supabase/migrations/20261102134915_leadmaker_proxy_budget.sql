-- Roadmap n°14 (validé par Gabriel le 2/11/2026) : budget de proxy par client, invisible pour lui.
-- - lm_plans.proxy_gb_month : Go de proxy par mois compris dans le forfait (≈ 10 % du prix : Growth 50,
--   Business 100, Scale 200). lm_account_credits.proxy_bytes_period : trafic consommé depuis la dernière
--   recharge (remis à zéro par lm_reset_credits), alimenté par lm_add_search_bytes (recherches ET estimations).
-- - lm_proxy_over_budget(compte) : vrai quand le budget du mois est dépassé.
-- - lm_schedule_discovery : compte au-delà du budget → over_budget_tasks_per_account (1) recherche à la fois
--   pour toutes ses campagnes, au lieu de tasks_per_campaign par campagne. La recherche ralentit, rien n'est
--   facturé en plus, rien n'est affiché au client.
alter table "public"."lm_account_credits" add column "proxy_bytes_period" bigint not null default 0;

alter table "public"."lm_discovery_settings" add column "over_budget_tasks_per_account" integer not null default 1;

alter table "public"."lm_plans" add column "proxy_gb_month" integer;

alter table "public"."lm_discovery_settings" add constraint "lm_discovery_settings_over_budget" CHECK ((over_budget_tasks_per_account > 0)) not valid;

alter table "public"."lm_discovery_settings" validate constraint "lm_discovery_settings_over_budget";

alter table "public"."lm_plans" add constraint "lm_plans_proxy_gb_month" CHECK (((proxy_gb_month IS NULL) OR (proxy_gb_month > 0))) not valid;

alter table "public"."lm_plans" validate constraint "lm_plans_proxy_gb_month";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_proxy_over_budget(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select c.proxy_bytes_period >= p.proxy_gb_month::bigint * 1000000000
       from public.lm_account_credits c
       join public.lm_plans p on p.id = c.plan_id
      where c.account_id = p_account_id and p.proxy_gb_month is not null),
    false);
$function$
;

CREATE OR REPLACE FUNCTION public.lm_add_search_bytes(p_task_id bigint, p_bytes bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_task public.lm_tasks%rowtype;
begin
  if p_bytes is null or p_bytes <= 0 then
    return;
  end if;

  select * into v_task from public.lm_tasks where id = p_task_id and kind in ('discovery', 'estimate');

  if v_task.id is null then
    return;
  end if;

  update public.lm_account_credits
     set proxy_bytes_period = proxy_bytes_period + p_bytes
   where account_id = v_task.account_id;

  if v_task.kind <> 'discovery' then
    return;
  end if;

  update public.lm_campaign_categories
     set proxy_bytes = proxy_bytes + p_bytes
   where campaign_id = (v_task.payload ->> 'campaign_id')::uuid and gcid = v_task.payload ->> 'gcid';

  update public.lm_searches s
     set proxy_bytes = s.proxy_bytes + p_bytes
   where s.id = (select s2.id from public.lm_searches s2
                  where s2.campaign_id = (v_task.payload ->> 'campaign_id')::uuid
                    and s2.category = v_task.payload ->> 'gcid'
                    and s2.zone_key = v_task.payload ->> 'zone'
                  order by s2.wave desc limit 1);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_reset_credits(p_account_id uuid, p_plan_id text, p_period_ends_at timestamp with time zone, p_event_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.lm_plans%rowtype;
begin
  select * into v_plan from public.lm_plans where id = p_plan_id;

  if v_plan.id is null then
    raise exception 'unknown plan %', p_plan_id;
  end if;

  if exists (select 1 from public.lm_credit_ledger where event_ref = p_event_ref || ':discovery') then
    return;
  end if;

  insert into public.lm_account_credits (account_id, plan_id, discovery_balance, outreach_balance, period_ends_at,
                                         proxy_bytes_period)
    values (p_account_id, p_plan_id, v_plan.discovery_credits, v_plan.outreach_credits, p_period_ends_at, 0)
  on conflict (account_id) do update set
    plan_id = excluded.plan_id,
    discovery_balance = excluded.discovery_balance,
    outreach_balance = excluded.outreach_balance,
    period_ends_at = excluded.period_ends_at,
    proxy_bytes_period = 0;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    values (p_account_id, 'discovery', v_plan.discovery_credits, 'renewal', p_event_ref || ':discovery'),
           (p_account_id, 'outreach', v_plan.outreach_credits, 'renewal', p_event_ref || ':outreach');
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
                -- prospects par Mo de proxy attendu : trafic mesuré de l'activité (sa moyenne par recherche
                -- s'applique aussi aux recherches en cours et au lissage), sinon le trafic par défaut
                cc.kept::numeric / case
                  when cc.proxy_bytes > 0 and cc.searches > 0
                    then cc.proxy_bytes / 1e6 * (cc.searches + cc.in_flight + v_settings.prior) / cc.searches
                  else v_settings.default_search_mb * (cc.searches + cc.in_flight + v_settings.prior)
                end desc,
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

-- Droits (non écrits par l'outil de diff)
revoke all on function public.lm_proxy_over_budget(uuid) from public;
grant execute on function public.lm_proxy_over_budget(uuid) to service_role;

-- Budgets des forfaits (≈ 10 % du prix en Go par mois)
update public.lm_plans set proxy_gb_month = 50  where id = 'growth';
update public.lm_plans set proxy_gb_month = 100 where id = 'business';
update public.lm_plans set proxy_gb_month = 200 where id = 'scale';
