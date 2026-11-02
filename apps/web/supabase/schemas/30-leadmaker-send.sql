/*
 * -------------------------------------------------------
 * Section: LeadMaker outreach — envoi des formulaires validés
 * Le worker « send » reprend chaque tentative validée, soumet le formulaire,
 * prend une capture après envoi et enregistre le résultat. Un crédit outreach
 * est débité à chaque soumission effective. Limite : par campagne (daily_limit, réglée par
 * l'utilisateur ; depuis le 2/11/2026 le forfait ne fixe plus de plafond par jour, seul le crédit
 * mensuel compte), un seul contact par site, jamais sans validation.
 * -------------------------------------------------------
 */

-- Envois comptés dans la journée (UTC) d'une campagne : soumis ou en cours
create or replace function public.lm_sends_today(p_campaign_id uuid) returns integer
set search_path = ''
language sql
stable
as $$
  select count(*)::integer from public.lm_attempts a
   where a.campaign_id = p_campaign_id
     and (a.status = 'sending' or (a.sent_at is not null and a.sent_at >= date_trunc('day', now())));
$$;

grant execute on function public.lm_sends_today(uuid) to authenticated, service_role;

-- Planification (worker, rôle service) : met en file les tentatives validées dans la limite quotidienne
-- de chaque campagne, tant qu'il reste des crédits outreach à l'organisation.
-- Une tentative restée « en envoi » plus de 20 minutes (worker arrêté) passe « à vérifier », jamais renvoyée.
create or replace function public.lm_queue_sends() returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_queue_sends() from public;

grant execute on function public.lm_queue_sends() to service_role;

-- Résultat d'un envoi (worker). submitted = le bouton d'envoi a été cliqué : un crédit outreach est débité
-- quel que soit le résultat. Une tentative qui n'est plus « en envoi » n'est pas modifiée.
create or replace function public.lm_finish_send(p_attempt_id uuid, p_result jsonb) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
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

  if v_submitted then
    perform public.lm_debit_credits(v_account, 'outreach', 1, 'send:' || p_attempt_id::text,
                                    'form submitted', v_campaign);
  end if;

  return true;
end;
$$;

revoke all on function public.lm_finish_send(uuid, jsonb) from public;

grant execute on function public.lm_finish_send(uuid, jsonb) to service_role;

-- « À vérifier » tranché à la main : bien arrivé (envoyé) ou pas arrivé (échec)
create or replace function public.lm_mark_attempts(p_ids uuid[], p_outcome text) returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
  v_status public.lm_attempt_status;
begin
  if p_outcome = 'sent' then
    v_status := 'sent';
  elsif p_outcome = 'failed' then
    v_status := 'failed';
  else
    raise exception 'unknown outcome %', p_outcome using errcode = 'check_violation';
  end if;

  with upd as (
    update public.lm_attempts a
       set status = v_status
     where a.id = any (p_ids)
       and public.has_role_on_account(a.account_id)
       and a.status = 'to_verify'
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$$;

revoke all on function public.lm_mark_attempts(uuid[], text) from public;

grant execute on function public.lm_mark_attempts(uuid[], text) to authenticated, service_role;
