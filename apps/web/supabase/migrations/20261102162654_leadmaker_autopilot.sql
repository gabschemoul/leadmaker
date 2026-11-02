-- Roadmap n°18 (décidé le 2/11/2026) : pilote automatique de l'étape « Contacter ».
-- Nouvelle table lm_autopilots (un passage par lancement), colonne lm_attempts.autopilot_id, fonctions du pilote
-- (lancement, modification, pause, reprise, aperçu, tour lm_autopilot_tick appelé par lm_queue_sends), index
-- sur les tâches ouvertes. Compatible avec le code en ligne : sans pilote, préparation et envoi se comportent
-- comme avant, avec deux corrections : lm_queue_sends ne met plus en file plus d'envois que de crédits restants
-- ni deux fois le même formulaire (verrou), et la validation automatique des campagnes est ouverte à tous les
-- forfaits (décision du 2/11).
-- Les droits d'exécution des fonctions et le revoke de la table sont recopiés à la main (migra ne les écrit pas).
create type "public"."lm_autopilot_schedule" as enum ('office', 'spread', 'continuous');

create type "public"."lm_autopilot_status" as enum ('preview', 'running', 'paused', 'done', 'cancelled');


  create table "public"."lm_autopilots" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid not null,
    "space_id" uuid not null,
    "campaign_id" uuid not null,
    "status" public.lm_autopilot_status not null default 'running'::public.lm_autopilot_status,
    "target" integer not null,
    "messages" text[] not null,
    "schedule" public.lm_autopilot_schedule not null default 'office'::public.lm_autopilot_schedule,
    "spread_days" integer not null default 5,
    "timezone" text not null default 'UTC'::text,
    "finished_reason" text,
    "finished_at" timestamp with time zone,
    "cursor_created_at" timestamp with time zone,
    "cursor_prospect_id" uuid,
    "ticked_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "updated_by" uuid
      );


alter table "public"."lm_autopilots" enable row level security;

revoke all on public.lm_autopilots from anon, authenticated, service_role;

comment on table public.lm_autopilots is 'Pilote automatique de l''étape Contacter : un passage par lancement, un seul actif par campagne';

alter table "public"."lm_attempts" add column "autopilot_id" uuid;

CREATE INDEX ix_lm_attempts_account_id_outbound ON public.lm_attempts USING btree (account_id) WHERE (status = ANY (ARRAY['validated'::public.lm_attempt_status, 'sending'::public.lm_attempt_status]));

CREATE INDEX ix_lm_attempts_autopilot_id_status ON public.lm_attempts USING btree (autopilot_id, status) WHERE (autopilot_id IS NOT NULL);

CREATE INDEX ix_lm_autopilots_account_id ON public.lm_autopilots USING btree (account_id);

CREATE INDEX ix_lm_autopilots_campaign_id_created_at ON public.lm_autopilots USING btree (campaign_id, created_at DESC);

CREATE INDEX ix_lm_tasks_account_send_open ON public.lm_tasks USING btree (account_id) WHERE ((kind = 'send'::public.lm_task_kind) AND (status = ANY (ARRAY['queued'::public.lm_task_status, 'running'::public.lm_task_status])));

CREATE INDEX ix_lm_tasks_attempt_open ON public.lm_tasks USING btree (((payload ->> 'attempt_id'::text))) WHERE (status = ANY (ARRAY['queued'::public.lm_task_status, 'running'::public.lm_task_status]));

CREATE UNIQUE INDEX lm_autopilots_pkey ON public.lm_autopilots USING btree (id);

CREATE UNIQUE INDEX ux_lm_autopilots_active_campaign ON public.lm_autopilots USING btree (campaign_id) WHERE (status = ANY (ARRAY['preview'::public.lm_autopilot_status, 'running'::public.lm_autopilot_status, 'paused'::public.lm_autopilot_status]));

alter table "public"."lm_autopilots" add constraint "lm_autopilots_pkey" PRIMARY KEY using index "lm_autopilots_pkey";

alter table "public"."lm_attempts" add constraint "lm_attempts_autopilot_id_fkey" FOREIGN KEY (autopilot_id) REFERENCES public.lm_autopilots(id) ON DELETE SET NULL not valid;

alter table "public"."lm_attempts" validate constraint "lm_attempts_autopilot_id_fkey";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_account_id_fkey";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_campaign_id_fkey";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_created_by_fkey";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_messages_not_empty" CHECK (((cardinality(messages) >= 1) AND (cardinality(messages) <= 4))) not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_messages_not_empty";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.lm_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_space_id_fkey";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_spread_days" CHECK (((spread_days >= 1) AND (spread_days <= 60))) not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_spread_days";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_target_positive" CHECK ((target > 0)) not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_target_positive";

alter table "public"."lm_autopilots" add constraint "lm_autopilots_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."lm_autopilots" validate constraint "lm_autopilots_updated_by_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_attempt_is_clean(p_status public.lm_attempt_status, p_detail text, p_protection_type text, p_missing jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_status = 'ready'
     and p_protection_type is null
     and coalesce(jsonb_array_length(p_missing), 0) = 0
     and (p_detail is null or p_detail = 'version courte utilisée (zone de message limitée)');
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
   where a.id = p_autopilot_id and public.has_role_on_account(a.account_id)
     and a.status in ('preview', 'running', 'paused')
   for update;

  if ap.id is null then
    raise exception 'autopilot not active' using errcode = 'P0001', hint = 'not_active';
  end if;

  return ap;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_ahead()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select 12 $function$
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
   where c.id = p_campaign_id and public.has_role_on_account(c.account_id);

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
     and public.has_role_on_account(p.account_id)
     and p.excluded_at is null and p.website is not null
     and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
     and not exists (select 1 from public.lm_attempts a where a.space_id = p.space_id and a.prospect_id = p.id);
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_counts(p_autopilot_id uuid)
 RETURNS TABLE(sent integer, in_flight integer, preview_ready integer, aside integer, total integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*) filter (where a.status in ('sent', 'to_verify'))::integer,
         count(*) filter (where a.status in ('pending', 'preparing', 'validated', 'sending'))::integer,
         count(*) filter (where public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))::integer,
         count(*) filter (where a.status not in ('sent', 'to_verify', 'pending', 'preparing', 'validated', 'sending')
                            and not public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))::integer,
         count(*)::integer
    from public.lm_attempts a
   where a.autopilot_id = p_autopilot_id;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_hold(p_autopilot_id uuid, p_sends_only boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.lm_tasks t set status = 'cancelled', finished_at = now()
   where t.status = 'queued'
     and t.kind = any (case when p_sends_only then array['send']::public.lm_task_kind[]
                            else array['send', 'prepare']::public.lm_task_kind[] end)
     and t.payload ->> 'attempt_id' in (select a.id::text from public.lm_attempts a where a.autopilot_id = p_autopilot_id);

  if not p_sends_only then
    update public.lm_attempts a set status = 'ready', validated_at = null, validated_by = null
     where a.autopilot_id = p_autopilot_id and a.status = 'validated';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_preview_size()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select 3 $function$
;

CREATE OR REPLACE FUNCTION public.lm_autopilot_slot(p_autopilot_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ap record;
  v_now timestamptz := now();
  v_local timestamp;
  v_day date;
  v_open timestamptz;
  v_close timestamptz;
  v_quota integer;
  v_used integer;
  v_last timestamptz;
  v_slot timestamptz;
begin
  select * into ap from public.lm_autopilots where id = p_autopilot_id;

  if ap.id is null or ap.schedule = 'continuous' then
    return v_now;
  end if;

  v_local := v_now at time zone ap.timezone;
  v_quota := greatest(ceil(ap.target::numeric / ap.spread_days)::integer, 1);

  for i in 0..90 loop
    v_day := v_local::date + i;

    -- 0 = dimanche, 6 = samedi
    if extract(dow from v_day) in (0, 6) then
      continue;
    end if;

    v_open := (v_day + time '09:00') at time zone ap.timezone;
    v_close := (v_day + time '18:00') at time zone ap.timezone;

    if v_now >= v_close then
      continue;
    end if;

    if ap.schedule = 'office' then
      return greatest(v_now, v_open);
    end if;

    select count(*), max(x.at) into v_used, v_last
      from (select a.sent_at as at from public.lm_attempts a
             where a.autopilot_id = ap.id and a.sent_at is not null
               and a.sent_at >= v_open and a.sent_at < v_close
            union all
            select case when t.status = 'running' then t.locked_at else t.run_after end
              from public.lm_tasks t
              join public.lm_attempts a on a.id::text = t.payload ->> 'attempt_id'
             where t.status in ('queued', 'running') and t.kind = 'send' and a.autopilot_id = ap.id
               and (case when t.status = 'running' then t.locked_at else t.run_after end) >= v_open
               and (case when t.status = 'running' then t.locked_at else t.run_after end) < v_close) x;

    if v_used >= v_quota then
      continue;
    end if;

    v_slot := greatest(v_now, v_open, coalesce(v_last + (v_close - v_open) / v_quota, v_open));

    if v_slot < v_close then
      return v_slot;
    end if;
  end loop;

  return v_now + interval '1 day';
end;
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
   where x.id = p_campaign_id and public.has_role_on_account(x.account_id);

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
           and pr.excluded_at is null and pr.website is not null
           and pr.site_key not like 'maps:%' and pr.site_key not like 'tel:%'
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

CREATE OR REPLACE FUNCTION public.lm_autopilot_validate_clean(p_autopilot_id uuid)
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
       set status = 'validated', validated_at = now(), validated_by = (select auth.uid())
     where a.autopilot_id = p_autopilot_id
       and public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing)
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_campaign_timezone(p_campaign_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    (select g.timezone from public.lm_campaign_zones z
       join public.lm_geo_cities g on g.geoname_id = z.geoname_id
      where z.campaign_id = p_campaign_id and g.timezone is not null
      order by g.population desc limit 1),
    (select g.timezone from public.lm_campaigns c
       join public.lm_geo_cities g on g.country_code = c.country_code
      where c.id = p_campaign_id and g.timezone is not null
      order by g.population desc limit 1),
    'UTC');
$function$
;

CREATE OR REPLACE FUNCTION public.lm_cancel_autopilot(p_autopilot_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ap public.lm_autopilots;
begin
  ap := public.lm_autopilot_active(p_autopilot_id);

  if ap.status <> 'preview' then
    return false;
  end if;

  perform public.lm_autopilot_hold(ap.id, false);

  delete from public.lm_attempts a where a.autopilot_id = ap.id and a.status = 'pending';

  update public.lm_autopilots set status = 'cancelled', finished_at = now() where id = ap.id;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_confirm_autopilot(p_autopilot_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ap public.lm_autopilots;
  v_count integer;
begin
  ap := public.lm_autopilot_active(p_autopilot_id);

  if ap.status <> 'preview' then
    return 0;
  end if;

  update public.lm_autopilots set status = 'running' where id = ap.id;
  v_count := public.lm_autopilot_validate_clean(ap.id);
  perform public.lm_autopilot_tick(ap.id);

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_outreach_reserved(p_account_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select ((select count(*) from public.lm_attempts a
             join public.lm_autopilots ap on ap.id = a.autopilot_id
            where ap.account_id = p_account_id and ap.status in ('preview', 'running', 'paused')
              and a.status in ('pending', 'preparing', 'validated', 'sending'))
        + (select count(*) from public.lm_attempts a
            where a.account_id = p_account_id and a.autopilot_id is null and a.status in ('validated', 'sending')))::integer;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_pause_autopilot(p_autopilot_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ap public.lm_autopilots;
begin
  ap := public.lm_autopilot_active(p_autopilot_id);

  if ap.status <> 'running' then
    return false;
  end if;

  update public.lm_autopilots set status = 'paused' where id = ap.id;
  perform public.lm_autopilot_hold(ap.id, false);

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_resume_autopilot(p_autopilot_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ap public.lm_autopilots;
begin
  ap := public.lm_autopilot_active(p_autopilot_id);

  if ap.status <> 'paused' then
    return false;
  end if;

  update public.lm_autopilots set status = 'running' where id = ap.id;
  perform public.lm_autopilot_validate_clean(ap.id);
  perform public.lm_autopilot_tick(ap.id);

  return true;
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

  select coalesce(cr.outreach_balance, 0) into v_balance
    from public.lm_account_credits cr where cr.account_id = v_campaign.account_id;

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

  select coalesce(cr.outreach_balance, 0) into v_balance
    from public.lm_account_credits cr where cr.account_id = ap.account_id;

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

CREATE OR REPLACE FUNCTION public.lm_auto_validation_allowed(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.lm_account_credits c where c.account_id = p_account_id and c.plan_id is not null);
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_prepare(p_attempt_id uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     where p.id = any (p_ids) and public.has_role_on_account(p.account_id)
     order by p.created_at
  loop
    v_attempt_id := null;

    -- Sans site web, exclu ou sans campagne : rien à préparer
    if r.excluded_at is not null or r.website is null or r.site_key like 'maps:%' or r.site_key like 'tel:%'
       or r.campaign_id is null then
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
       and public.has_role_on_account(a.account_id)
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

grant select on table "public"."lm_autopilots" to "authenticated";

grant delete on table "public"."lm_autopilots" to "service_role";

grant insert on table "public"."lm_autopilots" to "service_role";

grant select on table "public"."lm_autopilots" to "service_role";

grant update on table "public"."lm_autopilots" to "service_role";


  create policy "lm_autopilots_read"
  on "public"."lm_autopilots"
  as permissive
  for select
  to authenticated
using (public.has_role_on_account(account_id));



  create policy "restrict_mfa_lm_autopilots"
  on "public"."lm_autopilots"
  as restrictive
  for all
  to authenticated
using (public.is_mfa_compliant());


CREATE TRIGGER lm_autopilots_set_timestamps BEFORE INSERT OR UPDATE ON public.lm_autopilots FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

CREATE TRIGGER lm_autopilots_set_user_tracking BEFORE INSERT OR UPDATE ON public.lm_autopilots FOR EACH ROW EXECUTE FUNCTION public.trigger_set_user_tracking();

-- Droits des fonctions (recopiés du fichier de schéma)
revoke all on function public.lm_outreach_reserved(uuid) from public;
grant execute on function public.lm_outreach_reserved(uuid) to service_role;
grant execute on function public.lm_attempt_is_clean(public.lm_attempt_status, text, text, jsonb)
  to authenticated, service_role;
revoke all on function public.lm_autopilot_contactable(uuid) from public;
grant execute on function public.lm_autopilot_contactable(uuid) to authenticated, service_role;
grant execute on function public.lm_campaign_timezone(uuid) to authenticated, service_role;
revoke all on function public.lm_autopilot_slot(uuid) from public;
grant execute on function public.lm_autopilot_slot(uuid) to service_role;
revoke all on function public.lm_autopilot_counts(uuid) from public;
grant execute on function public.lm_autopilot_counts(uuid) to service_role;
grant execute on function public.lm_autopilot_ahead() to authenticated, service_role;
grant execute on function public.lm_autopilot_preview_size() to authenticated, service_role;
revoke all on function public.lm_autopilot_tick(uuid) from public;
grant execute on function public.lm_autopilot_tick(uuid) to service_role;
revoke all on function public.lm_autopilot_check(uuid, text[]) from public;
grant execute on function public.lm_autopilot_check(uuid, text[]) to service_role;
revoke all on function public.lm_start_autopilot(uuid, integer, text[], public.lm_autopilot_schedule, integer, boolean) from public;
grant execute on function public.lm_start_autopilot(uuid, integer, text[], public.lm_autopilot_schedule, integer, boolean)
  to authenticated, service_role;
revoke all on function public.lm_autopilot_active(uuid) from public;
grant execute on function public.lm_autopilot_active(uuid) to service_role;
revoke all on function public.lm_autopilot_hold(uuid, boolean) from public;
grant execute on function public.lm_autopilot_hold(uuid, boolean) to service_role;
revoke all on function public.lm_autopilot_validate_clean(uuid) from public;
grant execute on function public.lm_autopilot_validate_clean(uuid) to service_role;
revoke all on function public.lm_update_autopilot(uuid, integer, text[], public.lm_autopilot_schedule, integer) from public;
grant execute on function public.lm_update_autopilot(uuid, integer, text[], public.lm_autopilot_schedule, integer)
  to authenticated, service_role;
revoke all on function public.lm_pause_autopilot(uuid) from public;
grant execute on function public.lm_pause_autopilot(uuid) to authenticated, service_role;
revoke all on function public.lm_resume_autopilot(uuid) from public;
grant execute on function public.lm_resume_autopilot(uuid) to authenticated, service_role;
revoke all on function public.lm_confirm_autopilot(uuid) from public;
grant execute on function public.lm_confirm_autopilot(uuid) to authenticated, service_role;
revoke all on function public.lm_cancel_autopilot(uuid) from public;
grant execute on function public.lm_cancel_autopilot(uuid) to authenticated, service_role;
revoke all on function public.lm_autopilot_summary(uuid) from public;
grant execute on function public.lm_autopilot_summary(uuid) to authenticated, service_role;
