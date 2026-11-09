alter table "public"."lm_campaign_categories" add column "sorted" integer not null default 0;

alter table "public"."lm_campaign_categories" add column "sorted_kept" integer not null default 0;

alter table "public"."lm_campaign_prospects" add column "gcid" text;

alter table "public"."lm_campaign_prospects" add column "paid_at" timestamp with time zone;

alter table "public"."lm_discovery_settings" add column "sort_abandon_after" integer not null default 40;

alter table "public"."lm_discovery_settings" add column "sort_abandon_rate" numeric(4,3) not null default 0.03;

alter table "public"."lm_discovery_settings" add column "sort_credit_tiers" jsonb not null default '[{"credits": 1, "min_rate": 0.25}, {"credits": 2, "min_rate": 0.12}, {"credits": 4, "min_rate": 0.06}]'::jsonb;

alter table "public"."lm_discovery_settings" add column "sort_measure_size" integer not null default 300;

alter table "public"."lm_discovery_settings" add column "sort_pause_rate" numeric(4,3) not null default 0.06;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_credits_for_sort_rate(p_rate numeric)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
           when p_rate < s.sort_pause_rate then null
           else coalesce((select (t ->> 'credits')::integer
                            from jsonb_array_elements(s.sort_credit_tiers) t
                           where p_rate >= (t ->> 'min_rate')::numeric
                           order by (t ->> 'min_rate')::numeric desc
                           limit 1), 4)
         end
    from public.lm_discovery_settings s
   where s.id;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_measure_sort_price(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_size integer;
  v_sorted integer;
  v_kept integer;
  v_credits integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  if not v_campaign.price_pending or nullif(trim(v_campaign.sort_target), '') is null then
    return;
  end if;

  select sort_measure_size into v_size from public.lm_discovery_settings where id;

  select count(*), count(*) filter (where coalesce(cp.client_choice, cp.verdict) = 'gardee')
    into v_sorted, v_kept
    from public.lm_campaign_prospects cp
   where cp.campaign_id = p_campaign_id and cp.sorted_version = v_campaign.sort_version;

  if v_sorted < v_size then
    return;
  end if;

  -- Un seul passage fixe le prix (plusieurs robots trient en même temps)
  perform 1 from public.lm_campaigns where id = p_campaign_id and price_pending for update;

  if not found then
    return;
  end if;

  v_credits := public.lm_credits_for_sort_rate(v_kept::numeric / v_sorted);

  if v_credits is null then
    if v_campaign.status = 'running' then
      perform public.lm_pause_campaign(p_campaign_id, 'too_hard');
    end if;
    return;
  end if;

  update public.lm_campaigns set credits_per_prospect = v_credits, price_pending = false where id = p_campaign_id;

  perform public.lm_settle_kept(p_campaign_id, null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_outreach_balance(p_account_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when public.lm_has_plan(p_account_id) then 1000000000 else 0 end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_settle_kept(p_campaign_id uuid, p_prospect_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_count integer := 0;
  r record;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  if v_campaign.id is null or v_campaign.price_pending then
    return 0;
  end if;

  for r in
    select cp.prospect_id,
           exists (select 1 from public.lm_campaign_prospects o
                    where o.prospect_id = cp.prospect_id and o.campaign_id <> cp.campaign_id
                      and o.paid_at is not null) as already_paid
      from public.lm_campaign_prospects cp
     where cp.campaign_id = p_campaign_id
       and (p_prospect_id is null or cp.prospect_id = p_prospect_id)
       and cp.paid_at is null
       and coalesce(cp.client_choice, cp.verdict) = 'gardee'
     order by cp.sorted_at nulls last
     for update of cp skip locked
  loop
    if not r.already_paid
       and not public.lm_debit_credits(v_campaign.account_id, 'discovery', greatest(v_campaign.credits_per_prospect, 1),
                                       'keep:' || p_campaign_id::text || ':' || r.prospect_id::text, 'kept',
                                       p_campaign_id) then
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      exit;
    end if;

    update public.lm_campaign_prospects
       set paid_at = now(), credits = case when r.already_paid then 0 else greatest(v_campaign.credits_per_prospect, 1) end
     where campaign_id = p_campaign_id and prospect_id = r.prospect_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
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
      v_balance := public.lm_outreach_balance(ap.account_id);

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

  -- Crédit unique (9/11/2026) : l'envoi ne débite plus rien, il est compris dans le crédit de l'entreprise gardée.

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_sort(p_campaign_id uuid, p_prospect_id uuid, p_version integer, p_verdict text, p_group text, p_reason text, p_site_status text DEFAULT NULL::text, p_site_text text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_place_id text;
  v_count integer;
  v_gcid text;
  v_settings public.lm_discovery_settings%rowtype;
begin
  if p_verdict not in ('gardee', 'a_verifier', 'ecartee') then
    raise exception 'invalid verdict %', p_verdict using errcode = 'P0001';
  end if;

  -- Texte du site : pour tous les clients, même si l'avis arrive trop tard
  if p_site_status in ('ok', 'unreachable', 'social') then
    select p.google_place_id into v_place_id from public.lm_prospects p where p.id = p_prospect_id;

    if v_place_id is not null then
      update public.lm_places
         set site_status = p_site_status,
             site_text = case when p_site_status = 'ok' then left(p_site_text, 8000) end,
             site_read_at = now()
       where google_place_id = v_place_id;
    end if;
  end if;

  update public.lm_campaign_prospects cp
     set verdict = p_verdict,
         group_key = left(nullif(trim(p_group), ''), 60),
         reason = left(nullif(trim(p_reason), ''), 300),
         sorted_at = now(),
         sorted_version = p_version
   where cp.campaign_id = p_campaign_id and cp.prospect_id = p_prospect_id
     and p_version = (select c.sort_version from public.lm_campaigns c where c.id = p_campaign_id)
  returning cp.gcid into v_gcid;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return false;
  end if;

  select * into v_settings from public.lm_discovery_settings where id;

  -- Rendement du tri par activité ; une activité qui ne donne presque que des entreprises hors cible est
  -- abandonnée (la recherche cesse d'y dépenser du proxy)
  if v_gcid is not null then
    update public.lm_campaign_categories cc
       set sorted = cc.sorted + 1,
           sorted_kept = cc.sorted_kept + (p_verdict = 'gardee')::integer,
           abandoned = cc.abandoned
             or (cc.sorted + 1 >= v_settings.sort_abandon_after
                 and (cc.sorted_kept + (p_verdict = 'gardee')::integer)
                       < v_settings.sort_abandon_rate * (cc.sorted + 1))
     where cc.campaign_id = p_campaign_id and cc.gcid = v_gcid;
  end if;

  perform public.lm_measure_sort_price(p_campaign_id);

  if p_verdict = 'gardee' then
    perform public.lm_settle_kept(p_campaign_id, p_prospect_id);
  end if;

  return true;
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

    -- Crédit unique (9/11/2026) : un envoi confirmé à la main ne débite plus rien non plus.
  end loop;

  return v_count;
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
    v_balance := public.lm_outreach_balance(r.account_id);

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

CREATE OR REPLACE FUNCTION public.lm_record_estimate_search(p_estimate_id uuid, p_cards integer, p_place_ids text[], p_is_grid boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_est public.lm_estimates%rowtype;
  v_new integer;
  v_overlap numeric;
begin
  select * into v_est from public.lm_estimates where id = p_estimate_id for update;

  if v_est.id is null or v_est.status <> 'running' then
    return;
  end if;

  with ins as (
    insert into public.lm_estimate_places (estimate_id, google_place_id)
    select p_estimate_id, unnest(p_place_ids)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_new from ins;

  update public.lm_estimates
     set done_searches = done_searches + 1,
         cards = cards + p_cards,
         matching = matching + coalesce(array_length(p_place_ids, 1), 0)
   where id = p_estimate_id
  returning * into v_est;

  if v_est.done_searches < v_est.sample_searches then
    return;
  end if;

  -- Difficulté : part des fiches lues qui passent les filtres → crédits par prospect (roadmap n°13)
  update public.lm_estimates
     set rate = round(case when v_est.cards > 0 then v_est.matching::numeric / v_est.cards else 0 end, 4),
         credits_per_prospect = public.lm_credits_for_rate(
           case when v_est.cards > 0 then v_est.matching::numeric / v_est.cards end)
   where id = p_estimate_id;

  if v_est.mode = 'exact' then
    update public.lm_estimates
       set status = 'done', finished_at = now(), overlap = 1,
           expected = (select count(*) from public.lm_estimate_places where estimate_id = p_estimate_id),
           expected_low = (select count(*) from public.lm_estimate_places where estimate_id = p_estimate_id),
           expected_high = (select count(*) from public.lm_estimate_places where estimate_id = p_estimate_id)
     where id = p_estimate_id;
  else
    -- Recouvrement entre recherches voisines : part de fiches nouvelles mesurée sur les campagnes passées
    select case when sum(s.cards_seen) >= 2000 then sum(s.cards_new)::numeric / sum(s.cards_seen) end
      into v_overlap from public.lm_searches s;
    v_overlap := coalesce(v_overlap, 0.45);

    update public.lm_estimates
       set status = 'done', finished_at = now(), overlap = round(v_overlap, 4),
           expected = round(v_est.matching::numeric / v_est.sample_searches * v_est.total_searches * v_overlap),
           expected_low = round(v_est.matching::numeric / v_est.sample_searches * v_est.total_searches * v_overlap * 0.7),
           expected_high = round(v_est.matching::numeric / v_est.sample_searches * v_est.total_searches * v_overlap * 1.3)
     where id = p_estimate_id;
  end if;

  -- Campagnes lancées sans attendre cette mesure (4/11/2026) : leur tarif est fixé maintenant, pour la suite
  update public.lm_campaigns c
     set credits_per_prospect = coalesce(e.credits_per_prospect, 1), price_pending = false
    from public.lm_estimates e
   where e.id = p_estimate_id and c.estimate_id = p_estimate_id and c.price_pending
     -- campagne avec une cible en mots : son prix vient du tri IA (lm_finish_sort), pas de l'estimation
     and nullif(trim(c.sort_target), '') is null;
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
  v_credits integer;
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
    -- Déjà dans l'espace (trouvée par une autre campagne ou importée) : liée à cette campagne, sans débit
    insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits, paid_at, gcid)
    select p_campaign_id, p.id, p.account_id, p.space_id, 0, now(), nullif(p_place ->> 'gcid', '')
      from public.lm_prospects p
     where p.space_id = v_campaign.space_id and p.site_key = p_place ->> 'site_key'
    on conflict (campaign_id, prospect_id) do nothing;

    return 'duplicate';
  end if;

  if nullif(trim(v_campaign.sort_target), '') is not null then
    -- Payée plus tard, si le tri la garde ; plus aucun crédit : la recherche s'arrête là
    if coalesce((select c.discovery_balance from public.lm_account_credits c
                  where c.account_id = v_campaign.account_id), 0) <= 0 then
      delete from public.lm_prospects where id = v_id;
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      return 'no_credits';
    end if;
    v_credits := 0;
  else
    v_credits := greatest(v_campaign.credits_per_prospect, 1);

    if not public.lm_debit_credits(v_campaign.account_id, 'discovery', v_credits,
                                   'prospect:' || v_id, 'discovery', p_campaign_id) then
      delete from public.lm_prospects where id = v_id;
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      return 'no_credits';
    end if;
  end if;

  insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits, paid_at, gcid)
  values (p_campaign_id, v_id, v_campaign.account_id, v_campaign.space_id, v_credits,
          case when v_credits > 0 then now() end, nullif(p_place ->> 'gcid', ''))
  on conflict (campaign_id, prospect_id) do nothing;

  update public.lm_place_sightings set kept = true
   where space_id = v_campaign.space_id and google_place_id = p_place ->> 'place_id';

  return 'kept';
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
$function$
;

CREATE OR REPLACE FUNCTION public.lm_start_autopilot(p_campaign_id uuid, p_target integer, p_messages text[], p_schedule public.lm_autopilot_schedule, p_spread_days integer, p_preview boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns;
  v_contactable integer;
  v_balance integer;
  v_id uuid;
  v_timezone text;
begin
  v_campaign := public.lm_autopilot_check(p_campaign_id, p_messages);

  if p_target is null or p_target < 1 then
    raise exception 'target must be positive' using errcode = 'P0001', hint = 'target';
  end if;

  if p_schedule = 'spread' and (p_spread_days is null or p_spread_days not between 1 and 60) then
    raise exception 'invalid spread' using errcode = 'P0001', hint = 'schedule';
  end if;

  if exists (select 1 from public.lm_autopilots a
              where a.campaign_id = p_campaign_id and a.status in ('preview', 'running', 'paused')) then
    raise exception 'autopilot already active' using errcode = 'P0001', hint = 'active';
  end if;

  v_contactable := public.lm_autopilot_contactable(p_campaign_id);

  if v_contactable = 0 then
    raise exception 'no prospect to contact' using errcode = 'P0001', hint = 'no_prospects';
  end if;

  v_balance := public.lm_outreach_balance(v_campaign.account_id);

  v_balance := coalesce(v_balance, 0) - public.lm_outreach_reserved(v_campaign.account_id);

  if v_balance <= 0 then
    raise exception 'no outreach credits' using errcode = 'P0001', hint = 'no_credits';
  end if;

  -- Fuseau inconnu de la base (nom GeoNames inattendu) : UTC plutôt qu'une erreur à chaque tour
  v_timezone := public.lm_campaign_timezone(p_campaign_id);
  begin
    perform now() at time zone v_timezone;
  exception when others then
    v_timezone := 'UTC';
  end;

  insert into public.lm_autopilots (account_id, space_id, campaign_id, status, target, messages, schedule, spread_days, timezone)
  values (v_campaign.account_id, v_campaign.space_id, p_campaign_id,
          case when p_preview then 'preview'::public.lm_autopilot_status else 'running'::public.lm_autopilot_status end,
          least(p_target, v_contactable, v_balance), p_messages, p_schedule, coalesce(p_spread_days, 5), v_timezone)
  returning id into v_id;

  perform public.lm_autopilot_tick(v_id);

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_start_sort(p_campaign_id uuid, p_target text, p_offer text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_target text := nullif(trim(p_target), '');
  v_count integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_target is null then
    raise exception 'empty target' using errcode = 'P0001', hint = 'sort_target_required';
  end if;

  if v_campaign.sort_target is distinct from v_target then
    -- Nouvelle cible : nouvelle version, prix remesuré sur le tri (l'estimation ne le fixe plus), compteurs
    -- de tri par activité remis à zéro
    update public.lm_campaigns
       set sort_target = v_target, sort_version = sort_version + 1, price_pending = true, estimate_id = null
     where id = p_campaign_id
     returning * into v_campaign;

    update public.lm_campaign_categories set sorted = 0, sorted_kept = 0 where campaign_id = p_campaign_id;
  end if;

  if nullif(trim(p_offer), '') is not null then
    update public.lm_spaces set offer = trim(p_offer) where id = v_campaign.space_id;
  end if;

  insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
  select v_campaign.account_id, 'sort',
         jsonb_build_object('campaign_id', v_campaign.id, 'prospect_id', cp.prospect_id,
                            'version', v_campaign.sort_version),
         'sort:' || v_campaign.id::text || ':' || cp.prospect_id::text || ':' || v_campaign.sort_version::text
    from (select cp.prospect_id
            from public.lm_campaign_prospects cp
           where cp.campaign_id = p_campaign_id
             and cp.sorted_version is distinct from v_campaign.sort_version
           order by md5(cp.prospect_id::text)
           limit p_limit) cp
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_update_autopilot(p_autopilot_id uuid, p_target integer, p_messages text[], p_schedule public.lm_autopilot_schedule, p_spread_days integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ap public.lm_autopilots;
  c record;
  v_balance integer;
  v_target integer;
begin
  ap := public.lm_autopilot_active(p_autopilot_id);
  perform public.lm_autopilot_check(ap.campaign_id, p_messages);

  if p_target is null or p_target < 1 then
    raise exception 'target must be positive' using errcode = 'P0001', hint = 'target';
  end if;

  if p_schedule = 'spread' and (p_spread_days is null or p_spread_days not between 1 and 60) then
    raise exception 'invalid spread' using errcode = 'P0001', hint = 'schedule';
  end if;

  select * into c from public.lm_autopilot_counts(ap.id);

  v_balance := public.lm_outreach_balance(ap.account_id);

  v_target := greatest(c.sent + c.in_flight, 1,
                       least(p_target,
                             c.sent + c.in_flight
                               + least(public.lm_autopilot_contactable(ap.campaign_id),
                                       greatest(coalesce(v_balance, 0) - public.lm_outreach_reserved(ap.account_id), 0))));

  update public.lm_autopilots
     set target = v_target, messages = p_messages, schedule = p_schedule,
         spread_days = coalesce(p_spread_days, spread_days)
   where id = ap.id;

  -- Le moment d'envoi a changé : les envois en file sont reprogrammés au prochain tour
  if ap.schedule is distinct from p_schedule or ap.spread_days is distinct from coalesce(p_spread_days, ap.spread_days)
     or ap.target is distinct from v_target then
    perform public.lm_autopilot_hold(ap.id, true);
  end if;

  perform public.lm_autopilot_tick(ap.id);

  return v_target;
end;
$function$
;



-- Écrit à la main (db diff ne les génère pas) : droits
revoke all on function public.lm_credits_for_sort_rate(numeric) from public;
grant execute on function public.lm_credits_for_sort_rate(numeric) to service_role;
revoke all on function public.lm_measure_sort_price(uuid) from public;
grant execute on function public.lm_measure_sort_price(uuid) to service_role;
revoke all on function public.lm_settle_kept(uuid, uuid) from public;
grant execute on function public.lm_settle_kept(uuid, uuid) to service_role;
revoke all on function public.lm_outreach_balance(uuid) from public;
grant execute on function public.lm_outreach_balance(uuid) to service_role;

-- Données (CDC §5.3, décisions du 9/11) -------------------------------------------------------------------
-- Rattachements existants : tous payés à l'enregistrement (ancien modèle) ou déjà payés par l'équipe
update public.lm_campaign_prospects set paid_at = created_at where paid_at is null;

-- Forfaits : un seul solde, « crédits » = 15 000 / 40 000 / 100 000 (mêmes prix). outreach_credits reste tel quel
-- tant que les écrans de prospectigo.com l'affichent (il n'est plus ni lu ni débité) ; retiré plus tard.
update public.lm_plans set discovery_credits = 15000 where id = 'growth';
update public.lm_plans set discovery_credits = 40000 where id = 'business';
update public.lm_plans set discovery_credits = 100000 where id = 'scale';

-- Soldes existants : pas de conversion (seuls des comptes internes existent), le solde unique est mis au volume
-- du forfait de chaque compte, avec sa trace dans le journal des crédits.
with changed as (
  select c.account_id, p.discovery_credits - c.discovery_balance as delta
    from public.lm_account_credits c join public.lm_plans p on p.id = c.plan_id
   where c.discovery_balance <> p.discovery_credits
), ledger as (
  insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
  select account_id, 'discovery', delta, 'single_credit', 'single_credit:' || account_id::text from changed
  on conflict (event_ref) do nothing
  returning account_id
)
update public.lm_account_credits c
   set discovery_balance = p.discovery_credits
  from public.lm_plans p, ledger l
 where p.id = c.plan_id and c.account_id = l.account_id;

-- Campagnes déjà triées par l'IA (cible posée avant ces règles, ex. « Agences digital ») : prix remesuré sur le tri
-- au prochain avis rendu (lm_measure_sort_price), au lieu du prix de l'estimation
update public.lm_campaigns set price_pending = true, estimate_id = null where nullif(trim(sort_target), '') is not null;
