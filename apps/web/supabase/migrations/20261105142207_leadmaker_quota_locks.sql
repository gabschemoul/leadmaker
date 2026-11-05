set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_enforce_seat_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  -- une arrivée à la fois par organisation : deux acceptations simultanées ne dépassent pas le quota (audit A14)
  perform pg_advisory_xact_lock(hashtext('lm_seat_quota:' || new.account_id::text));

  select count(*) into v_count from public.accounts_memberships where account_id = new.account_id;

  if v_count >= public.lm_seat_limit(new.account_id) then
    raise exception 'seat quota reached for account %', new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_enforce_space_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  -- un ajout à la fois par organisation : deux créations simultanées ne dépassent pas le quota (audit A14)
  perform pg_advisory_xact_lock(hashtext('lm_space_quota:' || new.account_id::text));

  select count(*) into v_count from public.lm_spaces where account_id = new.account_id;

  if v_count >= public.lm_space_limit(new.account_id) then
    raise exception 'space quota reached for account %', new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
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

  select p.active_campaigns, c.discovery_balance into v_limit, v_balance
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


