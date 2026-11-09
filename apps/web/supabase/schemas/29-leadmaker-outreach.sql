/*
 * -------------------------------------------------------
 * Section: LeadMaker outreach — préparation des formulaires et validation
 * Le worker « prepare » ouvre le site d'un prospect, remplit le formulaire
 * de contact sans l'envoyer et enregistre le résultat sur la tentative
 * (lm_attempts). L'utilisateur valide ensuite, complète, passe ou exclut.
 * -------------------------------------------------------
 */

-- Captures d'écran des formulaires : bucket privé, chemin <account_id>/<attempt_id>-<moment>.png,
-- écrit par les workers (rôle service), lu par les membres de l'organisation via un lien signé.
insert into storage.buckets (id, name, public)
values ('lm_screenshots', 'lm_screenshots', false)
on conflict (id) do nothing;

create policy lm_screenshots_select on storage.objects for select
  to authenticated using (
    bucket_id = 'lm_screenshots'
    and public.has_role_on_account(((storage.foldername(name))[1])::uuid)
  );

-- Au moins un message utilisable (texte non vide) dans la colonne templates d'une campagne.
-- Formats acceptés : tableau (lot 0) ou objet { messages: [...], short: {...} }.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_templates_usable(p_templates jsonb) returns boolean
set search_path = ''
language sql
immutable
as $$
  select exists (
    select 1
      from jsonb_array_elements(
             case when jsonb_typeof(p_templates) = 'array' then p_templates
                  when jsonb_typeof(p_templates -> 'messages') = 'array' then p_templates -> 'messages'
                  else '[]'::jsonb end) m
     where length(trim(coalesce(m ->> 'body', ''))) > 0
  );
$$;

grant execute on function public.lm_templates_usable(jsonb) to authenticated, service_role;

-- Statuts d'une tentative que la préparation peut reprendre (jamais une tentative validée, envoyée ou en cours)
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_attempt_repreparable(p_status public.lm_attempt_status) returns boolean
set search_path = ''
language sql
immutable
as $$
  select p_status in ('no_form', 'unreachable', 'intervention_required', 'failed', 'skipped');
$$;

grant execute on function public.lm_attempt_repreparable(public.lm_attempt_status) to authenticated, service_role;

-- Demande la préparation des formulaires de prospects (membre de l'organisation).
-- p_campaign_id : campagne au nom de laquelle contacter les prospects qui lui sont liés (lm_campaign_prospects),
-- et campagne des prospects importés sans campagne (les messages de cette campagne sont utilisés).
-- Erreurs (hint) : no_sender, no_messages, cap_reached.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_prepare_prospects(p_ids uuid[], p_campaign_id uuid default null)
returns table (queued integer, skipped integer)
set search_path = ''
language plpgsql
security definer
as $$
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
           -- Entreprise liée à la campagne demandée (lm_campaign_prospects, CDC §7) : contactée au nom de celle-ci,
           -- avec ses messages ; sinon sa campagne d'origine, puis la campagne demandée (prospects importés)
           case
             when p_campaign_id is not null and exists (
                    select 1 from public.lm_campaign_prospects cp
                     where cp.campaign_id = p_campaign_id and cp.prospect_id = p.id) then p_campaign_id
             else coalesce(p.campaign_id, p_campaign_id)
           end as campaign_id
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
$$;

revoke all on function public.lm_prepare_prospects(uuid[], uuid) from public;

grant execute on function public.lm_prepare_prospects(uuid[], uuid) to authenticated, service_role;

-- Prépare les prospects d'une campagne qui ne l'ont pas encore été, dans la limite de la place restante sous le
-- plafond de l'espace (ready_forms_cap, 500 max) : les plus anciens d'abord, un nouveau clic prend les suivants.
-- 5/11/2026 : avant, toute la campagne partait d'un coup (46 000 prospects) → délai dépassé, ou plafond atteint en
-- cours de route et tout annulé. Erreur (hint) cap_reached si le plafond est déjà plein.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_prepare_campaign(p_campaign_id uuid)
returns table (queued integer, skipped integer)
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_prepare_campaign(uuid) from public;

grant execute on function public.lm_prepare_campaign(uuid) to authenticated, service_role;

-- Validation automatique : réservée aux forfaits qui l'incluent (et à l'option activée sur la campagne).
-- Depuis le 2/11/2026 (roadmap n°18) : ouverte à TOUS les forfaits, il suffit d'avoir un forfait.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_auto_validation_allowed(p_account_id uuid) returns boolean
set search_path = ''
language sql
stable
security definer
as $$
  select exists (select 1 from public.lm_account_credits c where c.account_id = p_account_id and c.plan_id is not null);
$$;
revoke all on function public.lm_auto_validation_allowed(uuid) from public;

grant execute on function public.lm_auto_validation_allowed(uuid) to authenticated, service_role;

-- L'option ne peut être activée sur une campagne que si le forfait le permet
-- Appelant : déclencheur (trigger).
create or replace function public.lm_campaigns_check_auto_validation() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if new.auto_validation and not coalesce(old.auto_validation, false)
     and not public.lm_auto_validation_allowed(new.account_id) then
    raise exception 'auto validation not included in plan' using errcode = 'P0001', hint = 'plan';
  end if;

  return new;
end;
$$;

create or replace trigger lm_campaigns_auto_validation
  before insert or update of auto_validation on public.lm_campaigns
  for each row execute function public.lm_campaigns_check_auto_validation();

-- Résultat de la préparation écrit par le robot : statut, message rendu, champs, capture.
-- Une tentative passée entre-temps (validée, exclue…) n'est pas écrasée ; sans alerte et avec la validation
-- automatique (ou le pilote), le formulaire est validé tout de suite.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_finish_prepare(p_attempt_id uuid, p_result jsonb) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_prospect uuid;
  v_email text;
  v_attempt record;
begin
  update public.lm_attempts
     set status = (p_result ->> 'status')::public.lm_attempt_status,
         template_name = coalesce(p_result ->> 'template_name', template_name),
         template_used = coalesce(p_result ->> 'template_used', template_used),
         subject = coalesce(p_result ->> 'subject', subject),
         body = coalesce(p_result ->> 'body', body),
         form_url = p_result ->> 'form_url',
         filled = coalesce(p_result -> 'filled', '{}'::jsonb),
         missing = coalesce(p_result -> 'missing', '[]'::jsonb),
         protection_type = p_result ->> 'protection_type',
         screenshot_before = p_result ->> 'screenshot_before',
         detail = p_result ->> 'detail'
   where id = p_attempt_id and status in ('pending', 'preparing')
  returning prospect_id, account_id, campaign_id, status, detail, missing, protection_type, autopilot_id into v_attempt;

  v_prospect := v_attempt.prospect_id;

  if v_prospect is null then
    return false;
  end if;

  -- Validation automatique (option de la campagne + forfait) : seulement un formulaire prêt sans la moindre alerte
  if v_attempt.status = 'ready' and v_attempt.detail is null and v_attempt.protection_type is null
     and coalesce(jsonb_array_length(v_attempt.missing), 0) = 0
     and v_attempt.autopilot_id is null  -- le pilote automatique a ses propres règles (aperçu, pause), plus bas
     and exists (select 1 from public.lm_campaigns c where c.id = v_attempt.campaign_id and c.auto_validation)
     and public.lm_auto_validation_allowed(v_attempt.account_id) then
    update public.lm_attempts
       set status = 'validated', validated_at = now(), validated_by = null
     where id = p_attempt_id;
  end if;

  -- Pilote automatique en marche (roadmap n°18) : un formulaire prêt sans aucun doute est validé et partira
  -- au moment choisi. En aperçu ou en pause, il reste « prêt » (confirmation ou reprise le valideront).
  if v_attempt.autopilot_id is not null
     and public.lm_attempt_is_clean(v_attempt.status, v_attempt.detail, v_attempt.protection_type, v_attempt.missing)
     and exists (select 1 from public.lm_autopilots ap where ap.id = v_attempt.autopilot_id and ap.status = 'running') then
    update public.lm_attempts
       set status = 'validated', validated_at = now(), validated_by = null
     where id = p_attempt_id and status = 'ready';
  end if;

  -- Email relevé sur le site : enregistré sur le prospect s'il n'en avait pas
  v_email := nullif(trim(coalesce(p_result ->> 'found_email', '')), '');

  if v_email is not null then
    update public.lm_prospects set found_email = v_email where id = v_prospect and found_email is null;
  end if;

  return true;
end;
$$;

revoke all on function public.lm_finish_prepare(uuid, jsonb) from public;

grant execute on function public.lm_finish_prepare(uuid, jsonb) to service_role;

-- Nombre de tentatives par statut dans un espace (pour les onglets de la page Formulaires)
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_attempt_counts(p_space_id uuid)
returns table (status public.lm_attempt_status, total bigint)
set search_path = ''
language sql
stable
as $$
  select a.status, count(*) from public.lm_attempts a where a.space_id = p_space_id group by a.status;
$$;

grant execute on function public.lm_attempt_counts(uuid) to authenticated, service_role;

-- Validation : formulaires prêts ou à compléter (tous les champs manquants renseignés) → validés.
-- Le validateur est enregistré. Renvoie le nombre de tentatives validées.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_validate_attempts(p_ids uuid[]) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_validate_attempts(uuid[]) from public;

grant execute on function public.lm_validate_attempts(uuid[]) to authenticated, service_role;

-- Passer : la tentative est abandonnée sans envoi, même validée tant qu'elle n'est pas partie
-- (le prospect reste contactable plus tard)
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_skip_attempts(p_ids uuid[]) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_skip_attempts(uuid[]) from public;

grant execute on function public.lm_skip_attempts(uuid[]) to authenticated, service_role;

-- Ne jamais contacter : tentative exclue et prospect mis en liste d'opposition
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_exclude_attempts(p_ids uuid[]) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_exclude_attempts(uuid[]) from public;

grant execute on function public.lm_exclude_attempts(uuid[]) to authenticated, service_role;

-- Modification avant validation : objet, message et valeurs saisies pour les champs manquants
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_update_attempt(p_id uuid, p_subject text, p_body text, p_extra jsonb) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_update_attempt(uuid, text, text, jsonb) from public;

grant execute on function public.lm_update_attempt(uuid, text, text, jsonb) to authenticated, service_role;

-- Affichage en direct des résultats de préparation (filtré par la RLS)
alter publication supabase_realtime add table public.lm_attempts;
