set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_sort_summary(p_campaign_id uuid)
 RETURNS TABLE(sort_target text, offer text, total integer, kept integer, to_check integer, pending integer, examined bigint, credits_per_prospect integer, price_pending boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
begin
  select * into v_campaign from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_campaign.id is null then
    return;
  end if;

  return query
  select v_campaign.sort_target,
         (select s.offer from public.lm_spaces s where s.id = v_campaign.space_id),
         count(*)::integer,
         count(*) filter (where coalesce(cp.client_choice, case when cp.sorted_version = v_campaign.sort_version
                                                                  then cp.verdict end) = 'gardee')::integer,
         count(*) filter (where cp.client_choice is null and cp.sorted_version = v_campaign.sort_version
                            and cp.verdict = 'a_verifier')::integer,
         count(*) filter (where cp.client_choice is null
                            and cp.sorted_version is distinct from v_campaign.sort_version)::integer,
         (select coalesce(sum(cc.cards), 0) from public.lm_campaign_categories cc where cc.campaign_id = p_campaign_id),
         v_campaign.credits_per_prospect,
         v_campaign.price_pending
    from public.lm_campaign_prospects cp
   where cp.campaign_id = p_campaign_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_choose_prospects(p_campaign_id uuid, p_prospect_ids uuid[], p_choice text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if p_choice not in ('gardee', 'ecartee') then
    raise exception 'invalid choice %', p_choice using errcode = 'P0001', hint = 'invalid_choice';
  end if;

  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  update public.lm_campaign_prospects cp
     set client_choice = p_choice, decided_at = now()
   where cp.campaign_id = p_campaign_id
     and cp.prospect_id = any (p_prospect_ids)
     and cp.client_choice is null
     and cp.verdict = 'a_verifier';

  get diagnostics v_count = row_count;

  if v_count > 0 and p_choice = 'gardee' then
    perform public.lm_measure_sort_price(p_campaign_id);
    perform public.lm_settle_kept(p_campaign_id, null);
  end if;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_prospect_campaign_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.campaign_id is not null then
    insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id)
    values (new.campaign_id, new.id, new.account_id, new.space_id)
    on conflict (campaign_id, prospect_id) do nothing;
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_set_sort_target(p_campaign_id uuid, p_target text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  return public.lm_start_sort(p_campaign_id, left(p_target, 500), null, null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_set_space_offer(p_space_id uuid, p_offer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.lm_spaces s
     set offer = left(nullif(trim(p_offer), ''), 1000)
   where s.id = p_space_id and public.lm_member(s.account_id);

  if not found then
    raise exception 'space not found' using errcode = 'P0002';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_contactable(p_campaign_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- accès vérifié UNE fois (5/11/2026 : vérifié ligne à ligne, la page d'une campagne à 12 000 prospects
  -- dépassait le délai de 8 s de la base)
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    return 0;
  end if;

  return (
    -- Entreprises de la campagne (lien campagne ↔ entreprise) ; campagne triée par l'IA : seulement les gardées
    -- et payées (CDC §5-6, 9/11/2026)
    select count(*)::integer
      from public.lm_campaign_prospects cp
      join public.lm_prospects p on p.id = cp.prospect_id
     where cp.campaign_id = p_campaign_id
       and (not (select nullif(trim(sc.sort_target), '') is not null from public.lm_campaigns sc where sc.id = p_campaign_id)
                 or (coalesce(cp.client_choice, cp.verdict) = 'gardee' and cp.paid_at is not null))
       and p.excluded_at is null and p.website is not null
       and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
       and not exists (select 1 from public.lm_attempts a where a.space_id = p.space_id and a.prospect_id = p.id));
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
          from public.lm_campaign_prospects cp
          join public.lm_prospects pr on pr.id = cp.prospect_id
         where cp.campaign_id = ap.campaign_id
           -- campagne triée par l'IA : seulement les entreprises gardées et payées (CDC §5-6)
           and (not (select nullif(trim(sc.sort_target), '') is not null from public.lm_campaigns sc where sc.id = ap.campaign_id)
                or (coalesce(cp.client_choice, cp.verdict) = 'gardee' and cp.paid_at is not null))
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
       and not exists (select 1 from public.lm_campaign_prospects cp
                          join public.lm_prospects pr on pr.id = cp.prospect_id
                        where cp.campaign_id = ap.campaign_id
                          and (not (select nullif(trim(sc.sort_target), '') is not null from public.lm_campaigns sc where sc.id = ap.campaign_id)
                 or (coalesce(cp.client_choice, cp.verdict) = 'gardee' and cp.paid_at is not null))
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

CREATE OR REPLACE FUNCTION public.lm_prepare_campaign(p_campaign_id uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids uuid[];
  v_space_id uuid;
  v_room integer;
begin
  -- accès vérifié une fois, pas ligne à ligne (grosses campagnes)
  select c.space_id into v_space_id
    from public.lm_campaigns c
   where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_space_id is null then
    return query select 0, 0;
    return;
  end if;

  -- place restante sous le plafond (même calcul que lm_prepare_prospects)
  select s.ready_forms_cap - (select count(*)::integer from public.lm_attempts a
                               where a.space_id = s.id and a.status in ('pending', 'preparing', 'ready', 'incomplete'))
    into v_room
    from public.lm_spaces s
   where s.id = v_space_id;

  if coalesce(v_room, 0) <= 0 then
    raise exception 'ready forms cap reached for space %', v_space_id using errcode = 'P0001', hint = 'cap_reached';
  end if;

  select array_agg(x.id order by x.created_at) into v_ids
    from (select p.id, p.created_at
            from public.lm_campaign_prospects cp
            join public.lm_prospects p on p.id = cp.prospect_id
            left join public.lm_attempts a on a.space_id = p.space_id and a.prospect_id = p.id
           where cp.campaign_id = p_campaign_id
             -- campagne triée par l'IA : seulement les entreprises gardées et payées (CDC §5-6)
             and (not (select nullif(trim(sc.sort_target), '') is not null from public.lm_campaigns sc where sc.id = p_campaign_id)
                 or (coalesce(cp.client_choice, cp.verdict) = 'gardee' and cp.paid_at is not null))
             and p.excluded_at is null and p.website is not null
             and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
             and (a.id is null or public.lm_attempt_repreparable(a.status))
           order by p.created_at
           limit v_room) x;

  if v_ids is null then
    return query select 0, 0;
    return;
  end if;

  return query select * from public.lm_prepare_prospects(v_ids, null);
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
  -- lien déjà posé par le déclencheur lm_prospects_campaign_link : on le complète
  on conflict (campaign_id, prospect_id) do update
    set credits = excluded.credits, paid_at = excluded.paid_at, gcid = excluded.gcid;

  update public.lm_place_sightings set kept = true
   where space_id = v_campaign.space_id and google_place_id = p_place ->> 'place_id';

  return 'kept';
end;
$function$
;

CREATE TRIGGER lm_prospects_campaign_link AFTER INSERT OR UPDATE OF campaign_id ON public.lm_prospects FOR EACH ROW EXECUTE FUNCTION public.lm_prospect_campaign_link();



-- Écrit à la main (db diff ne les génère pas) : droits
revoke all on function public.lm_prospect_campaign_link() from public;
revoke all on function public.lm_set_sort_target(uuid, text) from public;
grant execute on function public.lm_set_sort_target(uuid, text) to authenticated, service_role;
revoke all on function public.lm_set_space_offer(uuid, text) from public;
grant execute on function public.lm_set_space_offer(uuid, text) to authenticated, service_role;
revoke all on function public.lm_choose_prospects(uuid, uuid[], text) from public;
grant execute on function public.lm_choose_prospects(uuid, uuid[], text) to authenticated, service_role;
revoke all on function public.lm_campaign_sort_summary(uuid) from public;
grant execute on function public.lm_campaign_sort_summary(uuid) to authenticated, service_role;
