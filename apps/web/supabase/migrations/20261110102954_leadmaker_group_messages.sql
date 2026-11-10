-- 10/11/2026 : « Un message par groupe » dans la même campagne (remplace « Créer N campagnes ») : choix 'per_group',
-- lm_campaign_message_names, le pilote donne à chaque entreprise un message de son groupe, jusqu'à 24 messages.
-- Compatible avec le code en ligne (rien ne change tant qu'aucun message ne porte de groupe).

alter table "public"."lm_autopilots" drop constraint "lm_autopilots_messages_not_empty";

alter table "public"."lm_campaigns" drop constraint "lm_campaigns_groups_choice";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_messages_not_empty" CHECK (((cardinality(messages) >= 1) AND (cardinality(messages) <= 24))) not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_messages_not_empty";

alter table "public"."lm_campaigns" add constraint "lm_campaigns_groups_choice" CHECK (((groups_choice IS NULL) OR (groups_choice = ANY (ARRAY['single'::text, 'per_group'::text, 'split'::text])))) not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_groups_choice";

set check_function_bodies = off;


-- Écran « Résultats » d'une campagne en « Un message par groupe » (10/11/2026) : par groupe, les entreprises
-- gardées et payées, les prises de contact parties (sending, sent) et à vérifier (to_verify). group_key null =
-- hors groupes (« autre » ou pas encore classée). Comptages en base : pas de limite de 1 000 lignes.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_campaign_group_results(p_campaign_id uuid)
returns table (group_key text, kept bigint, sent bigint, to_verify bigint)
set search_path = ''
language sql
stable
security definer
as $$
  with c as (
    select c.id, c.sort_version, c.sort_groups from public.lm_campaigns c
     where c.id = p_campaign_id and public.lm_member(c.account_id)
  ), k as (
    select case when exists (select 1 from c, jsonb_array_elements(c.sort_groups) g where g ->> 'key' = cp.group_key)
                then cp.group_key end as group_key,
           cp.prospect_id
      from public.lm_campaign_prospects cp, c
     where cp.campaign_id = c.id and cp.paid_at is not null
       and coalesce(cp.client_choice, case when cp.sorted_version = c.sort_version then cp.verdict end) = 'gardee'
  )
  select k.group_key,
         count(*),
         count(*) filter (where a.status in ('sending', 'sent')),
         count(*) filter (where a.status = 'to_verify')
    from k
    left join public.lm_attempts a on a.campaign_id = p_campaign_id and a.prospect_id = k.prospect_id
   group by k.group_key;
$$;


CREATE OR REPLACE FUNCTION public.lm_campaign_message_names(p_campaign_id uuid, p_group text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with c as (
    select c.groups_choice,
           case when jsonb_typeof(c.templates) = 'array' then c.templates
                when jsonb_typeof(c.templates -> 'messages') = 'array' then c.templates -> 'messages'
                else '[]'::jsonb end as messages
      from public.lm_campaigns c where c.id = p_campaign_id
  ), m as (
    select coalesce(nullif(x ->> 'name', ''), 'Message ' || pos) as name, nullif(trim(x ->> 'group'), '') as grp, pos
      from c, jsonb_array_elements(c.messages) with ordinality as t(x, pos)
     where pos <= 24 and length(trim(coalesce(x ->> 'body', ''))) > 0
  )
  select case
           when (select groups_choice from c) = 'per_group' then
             coalesce((select array_agg(m.name order by m.pos) from m where m.grp = p_group),
                      (select array_agg(m.name order by m.pos) from m where m.grp is null),
                      (select array_agg(m.name order by m.pos) from m))
           else
             coalesce((select array_agg(m.name order by m.pos) from m where m.grp is null),
                      (select array_agg(m.name order by m.pos) from m))
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

  if v_campaign.status = 'archived' then
    raise exception 'campaign archived' using errcode = 'P0001', hint = 'archived';
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
   where pos <= 24 and length(trim(coalesce(m ->> 'body', ''))) > 0;

  if p_messages is null or cardinality(p_messages) = 0 or cardinality(p_messages) > 24
     or not (p_messages <@ coalesce(v_names, '{}'::text[])) then
    raise exception 'unknown message' using errcode = 'P0001', hint = 'messages';
  end if;

  return v_campaign;
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
  v_candidates text[];
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
        select pr.id, pr.account_id, pr.space_id, pr.created_at, cp.group_key
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

        -- Messages possibles pour cette entreprise : ceux de son groupe quand la campagne a « Un message par
        -- groupe » (10/11/2026), sinon ceux de la campagne
        v_candidates := public.lm_campaign_message_names(ap.campaign_id, p.group_key);

        -- Message coché le moins utilisé du passage (ex æquo : l'ordre de l'étape Rédiger) ; si aucun message
        -- coché ne convient au groupe, le moins utilisé des messages du groupe
        select m.name into v_template
          from unnest(ap.messages) with ordinality as m(name, pos)
         where v_candidates is null or m.name = any (v_candidates)
         order by (select count(*) from public.lm_attempts a
                    where a.autopilot_id = ap.id and a.template_name = m.name
                      and (a.status in ('pending', 'preparing', 'validated', 'sending', 'sent', 'to_verify')
                           or public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))),
                  m.pos
         limit 1;

        if v_template is null then
          select m.name into v_template
            from unnest(v_candidates) with ordinality as m(name, pos)
           order by (select count(*) from public.lm_attempts a
                      where a.autopilot_id = ap.id and a.template_name = m.name
                        and (a.status in ('pending', 'preparing', 'validated', 'sending', 'sent', 'to_verify')
                             or public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))),
                    m.pos
           limit 1;
        end if;

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

CREATE OR REPLACE FUNCTION public.lm_set_groups_choice(p_campaign_id uuid, p_choice text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_choice is not null and p_choice not in ('single', 'per_group') then
    raise exception 'invalid choice' using errcode = 'P0001', hint = 'invalid_choice';
  end if;

  update public.lm_campaigns c set groups_choice = p_choice
   where c.id = p_campaign_id and public.lm_member(c.account_id) and c.groups_choice is distinct from 'split';

  if not found then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
end;
$function$
;



revoke all on function public.lm_campaign_message_names(uuid, text) from public, anon, authenticated;

grant execute on function public.lm_campaign_message_names(uuid, text) to service_role;

revoke all on function public.lm_campaign_group_results(uuid) from public, anon;

grant execute on function public.lm_campaign_group_results(uuid) to authenticated, service_role;
