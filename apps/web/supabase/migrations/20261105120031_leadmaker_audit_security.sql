drop policy "lm_prospects_insert" on "public"."lm_prospects";

drop policy "lm_suppressions_read" on "public"."lm_suppressions";

revoke insert on table "public"."lm_campaigns" from "authenticated";

revoke insert on table "public"."lm_prospects" from "authenticated";

revoke insert on table "public"."lm_spaces" from "authenticated";

alter table "public"."lm_account_credits" add column "next_refill_at" timestamp with time zone;

alter table "public"."lm_campaigns" add constraint "lm_campaigns_daily_limit_max" CHECK ((daily_limit <= 100000)) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_daily_limit_max";

alter table "public"."lm_prospects" add constraint "lm_prospects_website_http" CHECK (((website IS NULL) OR ((website)::text ~* '^https?://[^/\s]+'::text))) not valid;

alter table "public"."lm_prospects" validate constraint "lm_prospects_website_http";

alter table "public"."lm_spaces" add constraint "lm_spaces_ready_forms_cap_max" CHECK ((ready_forms_cap <= 500)) not valid;

alter table "public"."lm_spaces" validate constraint "lm_spaces_ready_forms_cap_max";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaigns_normalize_filters()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.filters := public.lm_normalize_filters(new.filters);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_check_campaign_space()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.campaign_id is not null and not exists (
       select 1 from public.lm_campaigns c where c.id = new.campaign_id and c.space_id = new.space_id) then
    raise exception 'campaign % is not in space %', new.campaign_id, new.space_id using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_clean_website(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
           when v is null or v = '' then null
           when v ~* '^https?://[^/\s]+' then left(v, 1000)
           when v ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]+)?(/\S*)?$'
             then left('https://' || v, 1000)
         end
    from (select trim(p_url) as v) x;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_create_estimate(p_account_id uuid, p_country_code text, p_targeting jsonb, p_filters jsonb)
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
  -- Une seule estimation à la fois par organisation : la précédente est abandonnée, sauf celle qui fixera le
  -- tarif d'une campagne déjà lancée (price_pending, 4/11/2026)
  with dropped as (
    update public.lm_estimates e set status = 'failed', finished_at = now()
     where e.account_id = p_account_id and e.status = 'running'
       and not exists (select 1 from public.lm_campaigns c where c.estimate_id = e.id and c.price_pending)
    returning e.id
  )
  update public.lm_tasks t set status = 'cancelled', finished_at = now()
    from dropped d
   where t.kind = 'estimate' and t.status = 'queued' and t.account_id = p_account_id
     and t.payload ->> 'estimate_id' = d.id::text;

  select count(*) into v_zones from public.lm_target_zones(p_country_code, p_targeting);
  select count(*) into v_categories from public.lm_target_categories(p_targeting);
  v_total := v_zones * v_categories;

  if v_total = 0 then
    raise exception 'nothing to estimate' using errcode = 'P0001', hint = 'no_cities';
  end if;

  v_mode := case when v_total <= v_sample then 'exact' else 'sample' end;

  insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, total_searches, sample_searches)
  values (p_account_id, upper(p_country_code), p_targeting, public.lm_normalize_filters(p_filters), v_mode, v_total,
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

CREATE OR REPLACE FUNCTION public.lm_has_plan(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.lm_account_credits c
                  where c.account_id = p_account_id
                    and (c.plan_id is not null or c.discovery_balance > 0 or c.outreach_balance > 0));
$function$
;

CREATE OR REPLACE FUNCTION public.lm_member(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select public.has_role_on_account(p_account_id) and coalesce(public.is_mfa_compliant(), false);
$function$
;

CREATE OR REPLACE FUNCTION public.lm_normalize_filters(p_filters jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select '{"website": "with"}'::jsonb || coalesce(p_filters, '{}'::jsonb);
$function$
;

CREATE OR REPLACE FUNCTION public.lm_refill_credits()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select c.account_id, c.next_refill_at, p.discovery_credits, p.outreach_credits
      from public.lm_account_credits c
      join public.lm_plans p on p.id = c.plan_id
     where c.next_refill_at is not null and c.next_refill_at <= now()
       and (c.period_ends_at is null or c.period_ends_at > now())
     for update of c skip locked
  loop
    update public.lm_account_credits
       set discovery_balance = r.discovery_credits, outreach_balance = r.outreach_credits, proxy_bytes_period = 0,
           next_refill_at = r.next_refill_at + interval '1 month'
     where account_id = r.account_id;

    insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    values (r.account_id, 'discovery', r.discovery_credits, 'monthly_refill',
            'refill:' || r.account_id::text || ':' || r.next_refill_at::text || ':discovery'),
           (r.account_id, 'outreach', r.outreach_credits, 'monthly_refill',
            'refill:' || r.account_id::text || ':' || r.next_refill_at::text || ':outreach')
    on conflict (event_ref) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_site_suppressed(p_account_id uuid, p_space_id uuid, p_site_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.lm_suppressions s
                  where s.site_key = p_site_key
                    and (s.account_id is null
                         or (s.account_id = p_account_id and (s.space_id is null or s.space_id = p_space_id))));
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_active(p_autopilot_id uuid)
 RETURNS public.lm_autopilots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ap public.lm_autopilots;
begin
  select * into ap from public.lm_autopilots a
   where a.id = p_autopilot_id and public.lm_member(a.account_id)
     and a.status in ('preview', 'running', 'paused')
   for update;

  if ap.id is null then
    raise exception 'autopilot not active' using errcode = 'P0001', hint = 'not_active';
  end if;

  return ap;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_check(p_campaign_id uuid, p_messages text[])
 RETURNS public.lm_campaigns
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns;
  v_names text[];
begin
  select c.* into v_campaign
    from public.lm_campaigns c
   where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_campaign.id is null then
    raise exception 'campaign not found' using errcode = 'P0001', hint = 'not_found';
  end if;

  if not exists (select 1 from public.lm_sender_profiles s where s.space_id = v_campaign.space_id) then
    raise exception 'no sender profile' using errcode = 'P0001', hint = 'no_sender';
  end if;

  if not public.lm_templates_usable(v_campaign.templates) then
    raise exception 'campaign has no message' using errcode = 'P0001', hint = 'no_messages';
  end if;

  -- Noms des messages utilisables (même règle que le robot : texte non vide, « Message N » sans nom)
  select array_agg(coalesce(nullif(m ->> 'name', ''), 'Message ' || pos))
    into v_names
    from jsonb_array_elements(
           case when jsonb_typeof(v_campaign.templates) = 'array' then v_campaign.templates
                when jsonb_typeof(v_campaign.templates -> 'messages') = 'array' then v_campaign.templates -> 'messages'
                else '[]'::jsonb end) with ordinality as t(m, pos)
   where pos <= 4 and length(trim(coalesce(m ->> 'body', ''))) > 0;

  if p_messages is null or cardinality(p_messages) = 0 or cardinality(p_messages) > 4
     or not (p_messages <@ coalesce(v_names, '{}'::text[])) then
    raise exception 'unknown message' using errcode = 'P0001', hint = 'messages';
  end if;

  return v_campaign;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_contactable(p_campaign_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::integer
    from public.lm_prospects p
   where p.campaign_id = p_campaign_id
     and public.lm_member(p.account_id)
     and p.excluded_at is null and p.website is not null
     and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
     and not exists (select 1 from public.lm_attempts a where a.space_id = p.space_id and a.prospect_id = p.id);
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_summary(p_campaign_id uuid)
 RETURNS TABLE(autopilot_id uuid, status public.lm_autopilot_status, target integer, messages text[], schedule public.lm_autopilot_schedule, spread_days integer, timezone text, finished_reason text, started_at timestamp with time zone, sent integer, in_flight integer, preview_ready integer, aside integer, next_send_at timestamp with time zone, contactable integer, balance integer, contacted_before boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns;
  ap public.lm_autopilots;
  c record;
begin
  select * into v_campaign from public.lm_campaigns x
   where x.id = p_campaign_id and public.lm_member(x.account_id);

  if v_campaign.id is null then
    return;
  end if;

  select * into ap from public.lm_autopilots a where a.campaign_id = p_campaign_id
   order by a.created_at desc limit 1;

  -- sans pilote (ap.id vide), les compteurs valent 0
  select * into c from public.lm_autopilot_counts(ap.id);

  return query
  select ap.id, ap.status, ap.target, ap.messages, ap.schedule, ap.spread_days, ap.timezone, ap.finished_reason,
         ap.created_at, coalesce(c.sent, 0), coalesce(c.in_flight, 0), coalesce(c.preview_ready, 0), coalesce(c.aside, 0),
         (select min(t.run_after) from public.lm_tasks t
            join public.lm_attempts a on a.id::text = t.payload ->> 'attempt_id'
           where ap.id is not null and t.kind = 'send' and t.status = 'queued' and a.autopilot_id = ap.id),
         public.lm_autopilot_contactable(p_campaign_id),
         coalesce((select cr.outreach_balance from public.lm_account_credits cr where cr.account_id = v_campaign.account_id), 0),
         exists (select 1 from public.lm_attempts a where a.account_id = v_campaign.account_id and a.sent_at is not null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_tick(p_only uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ap record;
  c record;
  p record;
  v_created integer := 0;
  v_balance integer;
  v_want integer;
  v_template text;
  v_attempt uuid;
  v_found integer;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('lm_autopilot_tick')) then
    return 0;
  end if;

  -- Ligne verrouillée : une pause ou une modification en cours passe avant ce tour (le pilote est sauté)
  for ap in
    select a.* from public.lm_autopilots a
     where a.status in ('preview', 'running') and (p_only is null or a.id = p_only)
       and (p_only is not null or a.ticked_at is null or a.ticked_at < now() - interval '5 seconds')
     order by a.created_at
     for update skip locked
  loop
    update public.lm_autopilots set ticked_at = now() where id = ap.id;

    -- Préparation interrompue (robot arrêté en pleine visite : la tentative reste « en préparation » sans tâche)
    update public.lm_attempts a set status = 'pending'
     where a.autopilot_id = ap.id and a.status = 'preparing' and a.updated_at < now() - interval '10 minutes'
       and not exists (select 1 from public.lm_tasks t
                        where t.status in ('queued', 'running') and t.kind = 'prepare'
                          and t.payload ->> 'attempt_id' = a.id::text);

    -- Préparations restées sans tâche (pause puis reprise, tâche perdue) : remises en file
    insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
    select a.account_id, 'prepare', jsonb_build_object('attempt_id', a.id),
           'prepare:' || a.id::text || ':ap:' || extract(epoch from clock_timestamp())::bigint::text
      from public.lm_attempts a
     where a.autopilot_id = ap.id and a.status = 'pending'
       and not exists (select 1 from public.lm_tasks t
                        where t.status in ('queued', 'running') and t.kind = 'prepare'
                          and t.payload ->> 'attempt_id' = a.id::text)
    on conflict (idempotency_key) do nothing;

    select * into c from public.lm_autopilot_counts(ap.id);

    if ap.status = 'running' and c.sent >= ap.target then
      update public.lm_autopilots set status = 'done', finished_reason = 'target', finished_at = now()
       where id = ap.id and status = 'running';
      continue;
    end if;

    if ap.status = 'preview' then
      -- Aperçu : assez de formulaires prêts pour en montrer 3 (au plus 30 sites visités pour y arriver)
      v_want := least(public.lm_autopilot_preview_size() - c.preview_ready - c.in_flight, 30 - c.total);
    else
      select coalesce(cr.outreach_balance, 0) into v_balance
        from public.lm_account_credits cr where cr.account_id = ap.account_id;

      v_want := least(ap.target - c.sent - c.in_flight,
                      public.lm_autopilot_ahead() - c.in_flight,
                      coalesce(v_balance, 0) - public.lm_outreach_reserved(ap.account_id));
    end if;

    v_found := 0;
    v_cursor_at := ap.cursor_created_at;
    v_cursor_id := ap.cursor_prospect_id;

    if v_want > 0 then
      for p in
        select pr.id, pr.account_id, pr.space_id, pr.created_at
          from public.lm_prospects pr
         where pr.campaign_id = ap.campaign_id
           -- audit A1 : uniquement les prospects de l'espace du pilote (jamais ceux d'une autre organisation)
           and pr.space_id = ap.space_id and pr.account_id = ap.account_id
           and pr.excluded_at is null and pr.website is not null
           and pr.site_key not like 'maps:%' and pr.site_key not like 'tel:%'
           and not public.lm_site_suppressed(pr.account_id, pr.space_id, pr.site_key)
           and (pr.created_at, pr.id) > (coalesce(ap.cursor_created_at, '-infinity'::timestamptz),
                                         coalesce(ap.cursor_prospect_id, '00000000-0000-0000-0000-000000000000'::uuid))
           and not exists (select 1 from public.lm_attempts a where a.space_id = pr.space_id and a.prospect_id = pr.id)
         order by pr.created_at, pr.id
         limit v_want
      loop
        v_cursor_at := p.created_at;
        v_cursor_id := p.id;

        -- Message le moins utilisé du passage (ex æquo : l'ordre de l'étape Rédiger)
        select m.name into v_template
          from unnest(ap.messages) with ordinality as m(name, pos)
         order by (select count(*) from public.lm_attempts a
                    where a.autopilot_id = ap.id and a.template_name = m.name
                      and (a.status in ('pending', 'preparing', 'validated', 'sending', 'sent', 'to_verify')
                           or public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))),
                  m.pos
         limit 1;

        v_attempt := null;

        insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status, template_name, autopilot_id)
        values (p.account_id, p.space_id, ap.campaign_id, p.id, 'pending', v_template, ap.id)
        on conflict (space_id, prospect_id) do nothing
        returning id into v_attempt;

        if v_attempt is not null then
          insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
          values (p.account_id, 'prepare', jsonb_build_object('attempt_id', v_attempt), 'prepare:' || v_attempt::text || ':ap')
          on conflict (idempotency_key) do nothing;

          v_created := v_created + 1;
          v_found := v_found + 1;
        end if;
      end loop;

      if v_cursor_id is distinct from ap.cursor_prospect_id then
        update public.lm_autopilots set cursor_created_at = v_cursor_at, cursor_prospect_id = v_cursor_id
         where id = ap.id;
      end if;
    end if;

    -- Plus aucun prospect à contacter et plus rien en cours : passage terminé
    if ap.status = 'running' and v_found = 0 and c.in_flight = 0
       and not exists (select 1 from public.lm_prospects pr
                        where pr.campaign_id = ap.campaign_id
                          and pr.space_id = ap.space_id and pr.account_id = ap.account_id
                          and pr.excluded_at is null and pr.website is not null
                          and pr.site_key not like 'maps:%' and pr.site_key not like 'tel:%'
                          and (pr.created_at, pr.id) > (coalesce(v_cursor_at, '-infinity'::timestamptz),
                                                        coalesce(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid))
                          and not exists (select 1 from public.lm_attempts a
                                           where a.space_id = pr.space_id and a.prospect_id = pr.id)) then
      update public.lm_autopilots set status = 'done', finished_reason = 'no_prospects', finished_at = now()
       where id = ap.id and status = 'running';
    end if;
  end loop;

  return v_created;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_campaign_pricing(p_campaign_id uuid)
 RETURNS TABLE(frozen boolean, credits_per_prospect integer, rate numeric, estimate_id uuid, estimate_status text, done_searches integer, sample_searches integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with c as (
    select c.*, exists (select 1 from public.lm_campaign_zones z where z.campaign_id = c.id) as launched
      from public.lm_campaigns c where c.id = p_campaign_id
  ), e as (
    -- lancée : l'estimation qui a fixé (ou fixera) son tarif ; sinon la dernière faite avec ce ciblage
    select e.* from public.lm_estimates e, c
     where e.account_id = c.account_id
       and case when c.launched then e.id = c.estimate_id
                else e.country_code = c.country_code and e.targeting = c.targeting
                     and e.filters = (c.filters - 'paused_reason')
                     -- même choix que lm_start_campaign : la plus chère des 7 derniers jours
                     and (e.status <> 'done' or e.created_at > now() - interval '7 days') end
     order by (e.status = 'done') desc, e.credits_per_prospect desc nulls last, e.created_at desc
     limit 1
  ), x as (
    select c.*, c.launched and c.price_pending and e.status = 'running' as measuring,
           e.id as e_id, e.status as e_status, e.credits_per_prospect as e_credits, e.rate as e_rate,
           e.done_searches as e_done, e.sample_searches as e_sample
      from c left join e on true
  )
  select x.launched,
         case when x.measuring then null
              when x.launched then x.credits_per_prospect
              when x.e_status = 'done' then x.e_credits end,
         case when x.measuring then null
              when x.launched or x.e_status = 'done' then x.e_rate end,
         case when x.launched then x.estimate_id else x.e_id end,
         case when x.measuring then x.e_status when x.launched then null else x.e_status end,
         case when x.measuring or not x.launched then x.e_done end,
         case when x.measuring or not x.launched then x.e_sample end
    from x;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_debit_credits(p_account_id uuid, p_kind public.lm_credit_kind, p_quantity integer, p_event_ref text, p_reason text, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_balance integer;
begin
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  if exists (select 1 from public.lm_credit_ledger where event_ref = p_event_ref) then
    return false;
  end if;

  if p_kind = 'discovery' then
    select discovery_balance into v_balance from public.lm_account_credits
      where account_id = p_account_id for update;
  else
    select outreach_balance into v_balance from public.lm_account_credits
      where account_id = p_account_id for update;
  end if;

  if v_balance is null or v_balance < p_quantity then
    return false;
  end if;

  -- Deux appels simultanés avec le même event_ref : le second bute sur l'unicité du journal ; on annule
  -- alors son débit et on renvoie false, comme pour un événement déjà débité.
  begin
    insert into public.lm_credit_ledger (account_id, kind, delta, reason, campaign_id, event_ref)
      values (p_account_id, p_kind, -p_quantity, p_reason, p_campaign_id, p_event_ref);
  exception when unique_violation then
    return false;
  end;

  if p_kind = 'discovery' then
    update public.lm_account_credits set discovery_balance = discovery_balance - p_quantity
      where account_id = p_account_id;
  else
    update public.lm_account_credits set outreach_balance = outreach_balance - p_quantity
      where account_id = p_account_id;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_duplicate_campaign(p_campaign_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source public.lm_campaigns%rowtype;
  v_id uuid;
begin
  select * into v_source from public.lm_campaigns where id = p_campaign_id;

  if v_source.id is null or not public.lm_member(v_source.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters, templates,
                                   daily_limit, auto_validation, sender_id)
  values (v_source.account_id, v_source.space_id, left(p_name, 255), v_source.country_code, v_source.targeting,
          v_source.filters - 'paused_reason', v_source.templates, v_source.daily_limit,
          v_source.auto_validation and public.lm_auto_validation_allowed(v_source.account_id), v_source.sender_id)
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_exclude_attempts(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
  v_prospects uuid[];
begin
  with upd as (
    update public.lm_attempts a
       set status = 'excluded'
     where a.id = any (p_ids)
       and public.lm_member(a.account_id)
       and a.status not in ('sending', 'sent', 'to_verify', 'excluded')
    returning a.prospect_id
  )
  select count(*), array_agg(prospect_id) into v_count, v_prospects from upd;

  if v_prospects is not null then
    perform public.lm_exclude_prospects(v_prospects);
  end if;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_exclude_prospects(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with target as (
    select p.id, p.account_id, p.space_id, p.site_key
      from public.lm_prospects p
     where p.id = any (p_ids) and p.excluded_at is null and public.lm_member(p.account_id)
  ), upd as (
    update public.lm_prospects p set excluded_at = now()
      from target t where p.id = t.id
    returning t.account_id, t.space_id, t.site_key
  ), sup as (
    insert into public.lm_suppressions (account_id, space_id, site_key, reason)
    select distinct u.account_id, u.space_id, u.site_key, 'excluded'
      from upd u where u.site_key not like 'maps:%' and u.site_key not like 'tel:%'
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_find_emails(p_ids uuid[])
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_queued integer := 0;
  v_skipped integer := 0;
  v_round text := extract(epoch from clock_timestamp())::bigint::text;
  r record;
begin
  for r in
    select p.id, p.account_id, p.website, p.site_key, p.excluded_at, p.found_email
      from public.lm_prospects p
     where p.id = any (p_ids) and public.lm_member(p.account_id)
     order by p.created_at
  loop
    -- Robots réservés aux organisations avec un forfait (audit A9)
    if not public.lm_has_plan(r.account_id) then
      raise exception 'no plan for account %', r.account_id using errcode = 'P0001', hint = 'no_plan';
    end if;

    if r.excluded_at is not null or r.website is null or r.site_key like 'maps:%' or r.site_key like 'tel:%'
       or r.found_email is not null
       or exists (select 1 from public.lm_tasks t
                   where t.kind = 'emails' and t.status in ('queued', 'running')
                     and t.payload ->> 'prospect_id' = r.id::text) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
    values (r.account_id, 'emails', jsonb_build_object('prospect_id', r.id), 'emails:' || r.id::text || ':' || v_round)
    on conflict (idempotency_key) do nothing;

    v_queued := v_queued + 1;
  end loop;

  return query select v_queued, v_skipped;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_send(p_attempt_id uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account uuid;
  v_campaign uuid;
  v_status public.lm_attempt_status := (p_result ->> 'status')::public.lm_attempt_status;
  v_submitted boolean := coalesce((p_result ->> 'submitted')::boolean, false);
begin
  update public.lm_attempts
     set status = v_status,
         detail = p_result ->> 'detail',
         protection_type = coalesce(p_result ->> 'protection_type', protection_type),
         screenshot_after = coalesce(p_result ->> 'screenshot_after', screenshot_after),
         missing = coalesce(p_result -> 'missing', missing),
         template_used = coalesce(p_result ->> 'template_used', template_used),
         subject = coalesce(p_result ->> 'subject', subject),
         body = coalesce(p_result ->> 'body', body),
         sent_at = case when v_submitted then now() else sent_at end
   where id = p_attempt_id and status = 'sending'
  returning account_id, campaign_id into v_account, v_campaign;

  if v_account is null then
    return false;
  end if;

  -- Audit A13 : une référence par envoi (et non par prise de contact), sinon un formulaire re-préparé puis
  -- renvoyé ne coûtait rien la seconde fois. lm_finish_send ne passe qu'une fois par envoi (status = 'sending').
  if v_submitted then
    perform public.lm_debit_credits(v_account, 'outreach', 1,
                                    'send:' || p_attempt_id::text || ':' || extract(epoch from clock_timestamp())::text,
                                    'form submitted', v_campaign);
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_import_prospects(p_space_id uuid, p_rows jsonb)
 RETURNS TABLE(inserted integer, duplicates integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_country text;
  v_total integer;
  v_inserted integer;
begin
  select account_id, country_code into v_account_id, v_country from public.lm_spaces where id = p_space_id;

  if v_account_id is null or not public.lm_member(v_account_id) then
    raise exception 'space not found' using errcode = 'P0002';
  end if;

  v_total := jsonb_array_length(p_rows);

  if v_total > 20000 then
    raise exception 'too many rows' using errcode = 'P0001', hint = 'too_many_rows';
  end if;

  -- Audit A5/A10/A16 : adresse de site nettoyée (http(s) seulement), clé de site normalisée (minuscules, sans
  -- « / » final), sites en liste d'opposition importés mais exclus d'office (jamais contactés).
  with src as (
    select distinct on (k.site_key) r, k.site_key
      from jsonb_array_elements(p_rows) r
     cross join lateral (select rtrim(lower(trim(coalesce(r ->> 'site_key', ''))), '/') as site_key) k
     where length(k.site_key) > 0 and length(trim(coalesce(r ->> 'name', ''))) > 0
  ), ins as (
    insert into public.lm_prospects (account_id, space_id, name, category, phone, website, site_key, found_email,
                                     address, country_code, maps_url, source, city, excluded_at)
    select v_account_id, p_space_id, left(r ->> 'name', 500), left(r ->> 'category', 255), left(r ->> 'phone', 50),
           public.lm_clean_website(r ->> 'website'), src.site_key, left(r ->> 'email', 320), left(r ->> 'address', 1000),
           coalesce(nullif(upper(left(r ->> 'country_code', 2)), ''), v_country), left(r ->> 'maps_url', 1000), 'csv',
           left(nullif(trim(r ->> 'city'), ''), 200),
           case when public.lm_site_suppressed(v_account_id, p_space_id, src.site_key) then now() end
      from src
    on conflict (space_id, site_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return query select v_inserted, v_total - v_inserted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_local_discovery_state(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_last_seen timestamptz;
begin
  select account_id into v_account_id from public.lm_campaigns where id = p_campaign_id;

  if v_account_id is null or not public.lm_member(v_account_id) then
    return null;
  end if;

  select greatest(
           (select max(seen_at) from public.lm_local_workers),
           (select max(t.locked_at) from public.lm_tasks t
              join public.lm_local_discovery_campaigns l on l.campaign_id::text = t.payload ->> 'campaign_id'
             where t.kind = 'discovery' and t.status = 'running'))
    into v_last_seen;

  return jsonb_build_object(
    'allowed', exists (select 1 from public.lm_local_discovery_users where user_id = (select auth.uid())),
    'enabled', exists (select 1 from public.lm_local_discovery_campaigns where campaign_id = p_campaign_id),
    'last_seen', v_last_seen,
    'minutes_ago', floor(extract(epoch from now() - v_last_seen) / 60)::integer
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_mark_attempts(p_ids uuid[], p_outcome text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
  v_status public.lm_attempt_status;
  r record;
begin
  if p_outcome = 'sent' then
    v_status := 'sent';
  elsif p_outcome = 'failed' then
    v_status := 'failed';
  else
    raise exception 'unknown outcome %', p_outcome using errcode = 'check_violation';
  end if;

  v_count := 0;

  for r in
    update public.lm_attempts a
       set status = v_status
     where a.id = any (p_ids)
       and public.lm_member(a.account_id)
       and a.status = 'to_verify'
    returning a.id, a.account_id, a.campaign_id, a.validated_at
  loop
    v_count := v_count + 1;

    -- Audit A13 : un envoi interrompu (robot arrêté) n'avait pas été débité ; confirmé « bien parti » à la main,
    -- il l'est maintenant, sauf si cet envoi a déjà été débité par le robot.
    if v_status = 'sent' and not exists (
         select 1 from public.lm_credit_ledger l
          where l.account_id = r.account_id and l.event_ref like 'send:' || r.id::text || '%'
            and l.created_at >= coalesce(r.validated_at, '-infinity'::timestamptz)) then
      perform public.lm_debit_credits(r.account_id, 'outreach', 1,
                                      'send:' || r.id::text || ':manual:' || coalesce(r.validated_at::text, ''),
                                      'form confirmed sent', r.campaign_id);
    end if;
  end loop;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_on_subscription_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.lm_account_credits
     set plan_id = null, discovery_balance = 0, outreach_balance = 0, period_ends_at = null, next_refill_at = null,
         proxy_bytes_period = 0
   where account_id = old.account_id;

  return old;
end;
$function$
;

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
     or (auth.role() = 'authenticated' and not public.lm_member(v_account_id)) then
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

CREATE OR REPLACE FUNCTION public.lm_prepare_campaign(p_campaign_id uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids uuid[];
begin
  select array_agg(p.id order by p.created_at) into v_ids
    from public.lm_prospects p
    left join public.lm_attempts a on a.space_id = p.space_id and a.prospect_id = p.id
   where p.campaign_id = p_campaign_id
     and public.lm_member(p.account_id)
     and p.excluded_at is null and p.website is not null
     and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
     and (a.id is null or public.lm_attempt_repreparable(a.status));

  if v_ids is null then
    return query select 0, 0;
    return;
  end if;

  return query select * from public.lm_prepare_prospects(v_ids, null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_prepare_prospects(p_ids uuid[], p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_queued integer := 0;
  v_skipped integer := 0;
  v_round text := extract(epoch from clock_timestamp())::bigint::text;
  v_attempt_id uuid;
  v_ready integer;
  v_cap integer;
  r record;
begin
  for r in
    select p.id, p.account_id, p.space_id, p.website, p.site_key, p.excluded_at,
           coalesce(p.campaign_id, p_campaign_id) as campaign_id
      from public.lm_prospects p
     where p.id = any (p_ids) and public.lm_member(p.account_id)
     order by p.created_at
  loop
    v_attempt_id := null;

    -- Robots réservés aux organisations avec un forfait (audit A9)
    if not public.lm_has_plan(r.account_id) then
      raise exception 'no plan for account %', r.account_id using errcode = 'P0001', hint = 'no_plan';
    end if;

    -- Sans site web, exclu, en liste d'opposition ou sans campagne : rien à préparer
    if r.excluded_at is not null or r.website is null or r.site_key like 'maps:%' or r.site_key like 'tel:%'
       or r.campaign_id is null or public.lm_site_suppressed(r.account_id, r.space_id, r.site_key) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if not exists (select 1 from public.lm_sender_profiles s where s.space_id = r.space_id) then
      raise exception 'no sender profile for space %', r.space_id using errcode = 'P0001', hint = 'no_sender';
    end if;

    if not exists (select 1 from public.lm_campaigns c
                    where c.id = r.campaign_id and c.space_id = r.space_id and public.lm_templates_usable(c.templates)) then
      raise exception 'campaign % has no message', r.campaign_id using errcode = 'P0001', hint = 'no_messages';
    end if;

    -- Plafond de formulaires prêts non validés (par espace)
    select count(*) into v_ready from public.lm_attempts a
     where a.space_id = r.space_id and a.status in ('pending', 'preparing', 'ready', 'incomplete');
    select ready_forms_cap into v_cap from public.lm_spaces where id = r.space_id;

    if v_ready >= v_cap then
      raise exception 'ready forms cap reached for space %', r.space_id using errcode = 'P0001', hint = 'cap_reached';
    end if;

    insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status)
    values (r.account_id, r.space_id, r.campaign_id, r.id, 'pending')
    on conflict (space_id, prospect_id) do update
      set status = 'pending', campaign_id = excluded.campaign_id, detail = null, missing = '[]'::jsonb,
          filled = '{}'::jsonb, protection_type = null, screenshot_before = null, form_url = null,
          -- re-préparée à la main : elle quitte le pilote automatique et le robot rechoisit le message
          template_name = null, autopilot_id = null
      where public.lm_attempt_repreparable(public.lm_attempts.status)
    returning id into v_attempt_id;

    if v_attempt_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
    values (r.account_id, 'prepare', jsonb_build_object('attempt_id', v_attempt_id),
            'prepare:' || v_attempt_id::text || ':' || v_round)
    on conflict (idempotency_key) do nothing;

    v_queued := v_queued + 1;
  end loop;

  return query select v_queued, v_skipped;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_queue_sends()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_queued integer := 0;
  r record;
  v_balance integer;
  v_campaign_today integer;
  v_run_after timestamptz;
  v_reserved integer;
begin
  -- Une seule mise en file à la fois (une trentaine de robots appellent cette fonction) : sans ce verrou, deux
  -- robots pouvaient créer chacun une tâche d'envoi pour le même formulaire
  if not pg_try_advisory_xact_lock(hashtext('lm_queue_sends')) then
    return 0;
  end if;

  -- Pilote automatique (roadmap n°18) : préparations suivantes et fin des passages. Une erreur du pilote ne doit
  -- jamais bloquer les envois.
  begin
    perform public.lm_autopilot_tick();
  exception when others then
    raise warning 'lm_autopilot_tick : %', sqlerrm;
  end;

  -- Envois interrompus
  update public.lm_attempts a
     set status = 'to_verify', sent_at = coalesce(sent_at, now()),
         detail = 'envoi interrompu (robot arrêté) : vérifiez sur le site si le message est parti'
   where a.status = 'sending' and a.updated_at < now() - interval '20 minutes';

  -- Site passé en liste d'opposition après la validation (ex. l'entreprise a demandé à ne plus être
  -- contactée) : le formulaire ne part pas (audit A10)
  update public.lm_attempts a
     set status = 'excluded', detail = 'site en liste d''opposition'
    from public.lm_prospects p
   where a.status = 'validated' and p.id = a.prospect_id
     and public.lm_site_suppressed(a.account_id, a.space_id, p.site_key);

  for r in
    select a.id, a.account_id, a.campaign_id, c.daily_limit, a.autopilot_id, ap.status as autopilot_status
      from public.lm_attempts a
      join public.lm_campaigns c on c.id = a.campaign_id
      left join public.lm_autopilots ap on ap.id = a.autopilot_id
     where a.status = 'validated'
       and not exists (select 1 from public.lm_tasks t
                        where t.kind = 'send' and t.status in ('queued', 'running')
                          and t.payload ->> 'attempt_id' = a.id::text)
     order by a.validated_at
  loop
    select coalesce(cr.outreach_balance, 0) into v_balance
      from public.lm_account_credits cr
     where cr.account_id = r.account_id;

    -- Envois déjà en file ou en cours de l'organisation : jamais plus d'envois que de crédits
    select count(*)::integer into v_reserved from public.lm_tasks t
     where t.account_id = r.account_id and t.kind = 'send' and t.status in ('queued', 'running');

    if v_balance is null or v_balance - v_reserved <= 0 then
      continue;
    end if;

    -- Pilote automatique : son propre rythme (heures de bureau, étalé, en continu) remplace la limite du jour.
    -- Hors créneau, l'envoi est mis en file avec une heure de départ future.
    -- (aperçu ou pause : rien ne part ; pilote terminé ou annulé : envoi normal)
    if r.autopilot_status in ('preview', 'paused') then
      continue;
    end if;

    if r.autopilot_status = 'running' then
      begin
        v_run_after := public.lm_autopilot_slot(r.autopilot_id);
      exception when others then
        raise warning 'lm_autopilot_slot : %', sqlerrm;
        v_run_after := now() + interval '1 hour';
      end;

      insert into public.lm_tasks (account_id, kind, payload, idempotency_key, max_attempts, run_after)
      values (r.account_id, 'send', jsonb_build_object('attempt_id', r.id),
              -- à la microseconde : un envoi reprogrammé (changement de rythme) ne bute pas sur la clé de l'ancien
              'send:' || r.id::text || ':' || extract(epoch from clock_timestamp())::numeric(20, 6)::text, 1, v_run_after)
      on conflict (idempotency_key) do nothing;

      v_queued := v_queued + 1;
      continue;
    end if;

    v_campaign_today := public.lm_sends_today(r.campaign_id) + (
      select count(*)::integer from public.lm_tasks t
        join public.lm_attempts a2 on a2.id::text = t.payload ->> 'attempt_id'
       where t.kind = 'send' and t.status = 'queued' and a2.campaign_id = r.campaign_id
         -- les envois d'un pilote en marche suivent son rythme, pas la limite du jour de la campagne
         and not exists (select 1 from public.lm_autopilots ap2 where ap2.id = a2.autopilot_id and ap2.status = 'running'));

    if v_campaign_today >= r.daily_limit then
      continue;
    end if;

    insert into public.lm_tasks (account_id, kind, payload, idempotency_key, max_attempts)
    values (r.account_id, 'send', jsonb_build_object('attempt_id', r.id),
            'send:' || r.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text, 1)
    on conflict (idempotency_key) do nothing;

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_record_prospect(p_campaign_id uuid, p_place jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_id uuid;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  insert into public.lm_prospects (account_id, space_id, google_place_id, name, category, rating, review_count,
                                   address, country_code, phone, website, site_key, maps_url, source, campaign_id, city)
  values (v_campaign.account_id, v_campaign.space_id, p_place ->> 'place_id', left(p_place ->> 'name', 500),
          left(p_place ->> 'category', 255), (p_place ->> 'rating')::numeric(2,1), (p_place ->> 'review_count')::integer,
          p_place ->> 'address', v_campaign.country_code, left(p_place ->> 'phone', 50), public.lm_clean_website(p_place ->> 'website'),
          p_place ->> 'site_key', left(p_place ->> 'maps_url', 1000), 'maps', p_campaign_id, left(p_place ->> 'city', 200))
  on conflict (space_id, site_key) do nothing
  returning id into v_id;

  if v_id is null then
    return 'duplicate';
  end if;

  if not public.lm_debit_credits(v_campaign.account_id, 'discovery', greatest(v_campaign.credits_per_prospect, 1),
                                 'prospect:' || v_id, 'discovery', p_campaign_id) then
    delete from public.lm_prospects where id = v_id;
    perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
    return 'no_credits';
  end if;

  update public.lm_place_sightings set kept = true
   where space_id = v_campaign.space_id and google_place_id = p_place ->> 'place_id';

  return 'kept';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_request_campaign_estimate(p_campaign_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  return public.lm_request_estimate(v_campaign.account_id, v_campaign.country_code, v_campaign.targeting,
                                    v_campaign.filters - 'paused_reason');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_request_estimate(p_account_id uuid, p_country_code text, p_targeting jsonb, p_filters jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_recent integer;
  v_quota integer;
begin
  if not public.lm_member(p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  -- une demande à la fois par organisation (deux clics simultanés ne doublent pas le quota)
  perform pg_advisory_xact_lock(hashtext('lm_request_estimate:' || p_account_id::text));

  select count(*) into v_recent from public.lm_estimates
   where account_id = p_account_id and created_at > now() - interval '24 hours';

  v_quota := 3;

  if public.lm_has_plan(p_account_id) then
    v_quota := 40;
  end if;

  if v_recent >= v_quota then
    raise exception 'estimate quota reached' using errcode = 'P0001', hint = 'estimate_quota';
  end if;

  return public.lm_create_estimate(p_account_id, p_country_code, p_targeting, p_filters);
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
  v_old public.lm_plans%rowtype;
  v_current public.lm_account_credits%rowtype;
  v_refill timestamptz;
  v_discovery integer;
  v_outreach integer;
begin
  select * into v_plan from public.lm_plans where id = p_plan_id;

  if v_plan.id is null then
    raise exception 'unknown plan %', p_plan_id;
  end if;

  -- (un changement de forfait sans mouvement de crédits ne laisse pas de trace : le rejouer ne change rien)
  if exists (select 1 from public.lm_credit_ledger
              where event_ref in (p_event_ref || ':discovery', p_event_ref || ':outreach')) then
    return;
  end if;

  select * into v_current from public.lm_account_credits where account_id = p_account_id for update;

  v_refill := case when p_period_ends_at > now() + interval '35 days' then now() + interval '1 month' end;

  if v_current.plan_id is not null and v_current.plan_id <> p_plan_id
     and v_current.period_ends_at is not distinct from p_period_ends_at then
    -- Changement de forfait en cours de période
    select * into v_old from public.lm_plans where id = v_current.plan_id;

    v_discovery := greatest(0, least(v_current.discovery_balance + greatest(0, v_plan.discovery_credits - v_old.discovery_credits),
                                     v_plan.discovery_credits));
    v_outreach := greatest(0, least(v_current.outreach_balance + greatest(0, v_plan.outreach_credits - v_old.outreach_credits),
                                    v_plan.outreach_credits));

    update public.lm_account_credits
       set plan_id = p_plan_id, discovery_balance = v_discovery, outreach_balance = v_outreach
     where account_id = p_account_id;

    insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    select p_account_id, x.kind, x.delta, 'plan_change', p_event_ref || ':' || x.kind::text
      from (values ('discovery'::public.lm_credit_kind, v_discovery - v_current.discovery_balance),
                   ('outreach'::public.lm_credit_kind, v_outreach - v_current.outreach_balance)) as x(kind, delta)
     where x.delta <> 0;

    return;
  end if;

  insert into public.lm_account_credits (account_id, plan_id, discovery_balance, outreach_balance, period_ends_at,
                                         proxy_bytes_period, next_refill_at)
    values (p_account_id, p_plan_id, v_plan.discovery_credits, v_plan.outreach_credits, p_period_ends_at, 0, v_refill)
  on conflict (account_id) do update set
    plan_id = excluded.plan_id,
    discovery_balance = excluded.discovery_balance,
    outreach_balance = excluded.outreach_balance,
    period_ends_at = excluded.period_ends_at,
    proxy_bytes_period = 0,
    next_refill_at = excluded.next_refill_at;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
    values (p_account_id, 'discovery', v_plan.discovery_credits, 'renewal', p_event_ref || ':discovery'),
           (p_account_id, 'outreach', v_plan.outreach_credits, 'renewal', p_event_ref || ':outreach');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_restore_prospects(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with target as (
    select p.id, p.space_id, p.site_key
      from public.lm_prospects p
     where p.id = any (p_ids) and p.excluded_at is not null and public.lm_member(p.account_id)
  ), upd as (
    update public.lm_prospects p set excluded_at = null
      from target t where p.id = t.id
    returning t.space_id, t.site_key
  ), del as (
    delete from public.lm_suppressions s
     using upd u
     where s.space_id = u.space_id and s.site_key = u.site_key and s.reason = 'excluded'
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_set_local_discovery(p_campaign_id uuid, p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from public.lm_campaigns where id = p_campaign_id;

  if v_account_id is null or not public.lm_member(v_account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.lm_local_discovery_users where user_id = (select auth.uid())) then
    raise exception 'local discovery not allowed' using errcode = '42501';
  end if;

  if p_enabled then
    insert into public.lm_local_discovery_campaigns (campaign_id, enabled_by)
    values (p_campaign_id, (select auth.uid()))
    on conflict (campaign_id) do nothing;
  else
    delete from public.lm_local_discovery_campaigns where campaign_id = p_campaign_id;
  end if;

  return p_enabled;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_skip_attempts(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with upd as (
    update public.lm_attempts a
       set status = 'skipped'
     where a.id = any (p_ids)
       and public.lm_member(a.account_id)
       and a.status in ('pending', 'ready', 'incomplete', 'intervention_required', 'no_form', 'unreachable', 'failed', 'validated')
       and not exists (select 1 from public.lm_tasks t
                        where t.kind = 'send' and t.status = 'running' and t.payload ->> 'attempt_id' = a.id::text)
    returning a.id
  ), cancelled as (
    update public.lm_tasks t set status = 'cancelled', finished_at = now()
     where t.kind = 'send' and t.status = 'queued' and t.payload ->> 'attempt_id' in (select id::text from upd)
    returning 1
  )
  select count(*) into v_count from upd;

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

CREATE OR REPLACE FUNCTION public.lm_update_attempt(p_id uuid, p_subject text, p_body text, p_extra jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_found boolean;
begin
  if length(coalesce(p_body, '')) > 5000 or length(coalesce(p_subject, '')) > 200 then
    raise exception 'message too long' using errcode = 'check_violation';
  end if;

  with upd as (
    update public.lm_attempts a
       set subject = p_subject, body = p_body, extra = coalesce(p_extra, '{}'::jsonb)
     where a.id = p_id
       and public.lm_member(a.account_id)
       and a.status in ('ready', 'incomplete')
    returning 1
  )
  select exists (select 1 from upd) into v_found;

  return v_found;
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

CREATE OR REPLACE FUNCTION public.lm_validate_attempts(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with upd as (
    -- validé à la main (mode Avancé) : le formulaire quitte le pilote automatique et suit l'envoi normal
    update public.lm_attempts a
       set status = 'validated', validated_by = (select auth.uid()), validated_at = now(), autopilot_id = null
     where a.id = any (p_ids)
       and public.lm_member(a.account_id)
       and a.status in ('ready', 'incomplete')
       and not exists (
         select 1 from jsonb_array_elements_text(a.missing) m
          where coalesce(trim(a.extra ->> m), '') = ''
       )
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;


  create policy "lm_suppressions_read"
  on "public"."lm_suppressions"
  as permissive
  for select
  to authenticated
using (((account_id IS NOT NULL) AND public.has_role_on_account(account_id)));


CREATE TRIGGER lm_attempts_check_campaign_space BEFORE INSERT OR UPDATE OF campaign_id, space_id ON public.lm_attempts FOR EACH ROW EXECUTE FUNCTION public.lm_check_campaign_space();

CREATE TRIGGER lm_campaigns_normalize_filters BEFORE INSERT OR UPDATE OF filters ON public.lm_campaigns FOR EACH ROW EXECUTE FUNCTION public.lm_campaigns_normalize_filters();

CREATE TRIGGER lm_prospects_check_campaign_space BEFORE INSERT OR UPDATE OF campaign_id, space_id ON public.lm_prospects FOR EACH ROW EXECUTE FUNCTION public.lm_check_campaign_space();



-- ---------------------------------------------------------------------------------------------------------
-- Écrit à la main (db diff n'émet ni les droits par colonne ni les droits sur les fonctions) — audit 5/11/2026
-- ---------------------------------------------------------------------------------------------------------

-- A2/A3 : colonnes que le client peut fixer lui-même ; le reste passe par les fonctions serveur
grant insert (id, account_id, space_id, name, country_code, targeting, filters, templates, daily_limit, sender_id)
  on table public.lm_campaigns to authenticated;

revoke update (country_code, targeting, filters) on table public.lm_campaigns from authenticated;

-- A9
grant insert (account_id, name, country_code, language_code) on table public.lm_spaces to authenticated;

revoke update (ready_forms_cap) on table public.lm_spaces from authenticated;

-- Nouvelles fonctions
grant execute on function public.lm_member(uuid) to authenticated, service_role;

revoke all on function public.lm_has_plan(uuid) from public, anon, authenticated;
grant execute on function public.lm_has_plan(uuid) to service_role;

revoke all on function public.lm_refill_credits() from public, anon, authenticated;
grant execute on function public.lm_refill_credits() to service_role;

revoke all on function public.lm_create_estimate(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lm_create_estimate(uuid, text, jsonb, jsonb) to service_role;

revoke all on function public.lm_request_estimate(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.lm_request_estimate(uuid, text, jsonb, jsonb) to authenticated, service_role;

grant execute on function public.lm_clean_website(text) to authenticated, service_role;

grant execute on function public.lm_normalize_filters(jsonb) to authenticated, service_role;

revoke all on function public.lm_check_campaign_space() from public, anon, authenticated;

revoke all on function public.lm_campaigns_normalize_filters() from public, anon, authenticated;

revoke all on function public.lm_site_suppressed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lm_site_suppressed(uuid, uuid, text) to service_role;

-- A15 : quotas lus seulement par les déclencheurs (qui s'exécutent avec les droits du propriétaire)
revoke execute on function public.lm_seat_limit(uuid) from authenticated;
revoke execute on function public.lm_space_limit(uuid) from authenticated;

-- A12 : recharge mensuelle des forfaits annuels, toutes les heures (idempotente)
create extension if not exists pg_cron;

select cron.schedule('lm-refill-credits', '7 * * * *', 'select public.lm_refill_credits()');
