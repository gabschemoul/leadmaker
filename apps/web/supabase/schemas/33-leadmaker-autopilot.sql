/*
 * -------------------------------------------------------
 * Section: LeadMaker pilote automatique de l'étape « Contacter » (roadmap n°18, décidé le 2/11/2026)
 *
 * L'utilisateur choisit un nombre de prises de contact, un ou plusieurs messages (plusieurs = test A/B
 * à parts égales) et un moment d'envoi (heures de bureau, étalé sur N jours ouvrés, en continu).
 * Prospectigo prépare puis envoie, prospect après prospect, dans l'ordre où ils ont été trouvés,
 * jusqu'au nombre choisi. Les cas douteux (captcha, champ inconnu, pas de formulaire, alerte) sont mis
 * de côté sans crédit dépensé et restent visibles dans le mode Avancé.
 *
 * Tout le pilotage est en SQL : lm_autopilot_tick() est appelée par lm_queue_sends(), que les robots
 * d'envoi appellent déjà à chaque tour. Les envois hors créneau sont mis en file avec une heure de départ
 * future (run_after) : rien n'attend « validé sans tâche », le surveillant (n°17) ne voit donc pas de
 * fausse panne la nuit ou le week-end.
 * -------------------------------------------------------
 */
create type public.lm_autopilot_status as enum (
  'preview',   -- aperçu : les 3 premiers formulaires sont préparés, rien ne part avant confirmation
  'running',   -- en marche
  'paused',    -- en pause (rien n'est préparé ni envoyé)
  'done',      -- terminé (nombre atteint ou plus aucun prospect à contacter)
  'cancelled'  -- annulé depuis l'aperçu
);

create type public.lm_autopilot_schedule as enum (
  'office',     -- heures de bureau : lundi-vendredi 9 h-18 h, heure des entreprises contactées
  'spread',     -- étalé sur N jours ouvrés, pendant les heures de bureau, à rythme régulier
  'continuous'  -- dès que possible, jour et nuit
);

create table if not exists public.lm_autopilots (
  id uuid not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  space_id uuid references public.lm_spaces(id) on delete cascade not null,
  campaign_id uuid references public.lm_campaigns(id) on delete cascade not null,
  status public.lm_autopilot_status not null default 'running',
  -- Nombre de prises de contact à envoyer (messages partis) pendant ce passage du pilote
  target integer not null,
  -- Noms des messages de l'étape Rédiger à envoyer (plusieurs = test A/B à parts égales)
  messages text[] not null,
  schedule public.lm_autopilot_schedule not null default 'office',
  spread_days integer not null default 5,
  -- Fuseau horaire des entreprises contactées (plus grande ville du ciblage), fixé au lancement
  timezone text not null default 'UTC',
  -- 'target' (nombre atteint) ou 'no_prospects' (plus personne à contacter)
  finished_reason text,
  finished_at timestamptz,
  -- Dernier prospect pris (ordre de découverte) : le tour suivant repart de là au lieu de relire la campagne
  cursor_created_at timestamptz,
  cursor_prospect_id uuid,
  -- Dernier tour du pilote : au plus un tour toutes les 5 secondes par passage
  ticked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  updated_by uuid references auth.users on delete set null,
  primary key (id),
  constraint lm_autopilots_target_positive check (target > 0),
  constraint lm_autopilots_messages_not_empty check (cardinality(messages) between 1 and 4),
  constraint lm_autopilots_spread_days check (spread_days between 1 and 60)
);

comment on table public.lm_autopilots is 'Pilote automatique de l''étape Contacter : un passage par lancement, un seul actif par campagne';

alter table public.lm_autopilots enable row level security;

revoke all on public.lm_autopilots from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_autopilots to service_role;

-- Lecture seule pour les membres : tout changement passe par les fonctions ci-dessous (contrôles et file)
grant select on table public.lm_autopilots to authenticated;

create trigger lm_autopilots_set_timestamps
  before insert or update on public.lm_autopilots
  for each row execute function public.trigger_set_timestamps();

create trigger lm_autopilots_set_user_tracking
  before insert or update on public.lm_autopilots
  for each row execute function public.trigger_set_user_tracking();

-- Un seul pilote actif par campagne
create unique index if not exists ux_lm_autopilots_active_campaign
  on public.lm_autopilots (campaign_id) where status in ('preview', 'running', 'paused');

create index if not exists ix_lm_autopilots_campaign_id_created_at
  on public.lm_autopilots (campaign_id, created_at desc);

create index if not exists ix_lm_autopilots_account_id
  on public.lm_autopilots (account_id);

create policy "lm_autopilots_read" on public.lm_autopilots for select
  to authenticated using (public.has_role_on_account(account_id));

create policy "restrict_mfa_lm_autopilots" on public.lm_autopilots
  as restrictive to authenticated using (public.is_mfa_compliant());

-- Tentative créée par le pilote automatique (null = préparée à la main, mode Avancé)
alter table public.lm_attempts
  add column if not exists autopilot_id uuid references public.lm_autopilots(id) on delete set null;

create index if not exists ix_lm_attempts_autopilot_id_status
  on public.lm_attempts (autopilot_id, status) where autopilot_id is not null;

-- Formulaires validés ou en envoi d'une organisation (crédits réservés, voir lm_outreach_reserved)
create index if not exists ix_lm_attempts_account_id_outbound
  on public.lm_attempts (account_id) where status in ('validated', 'sending');

-- Tâches en file ou en cours d'une tentative (préparation, envoi) : la table n'est jamais purgée, ces
-- recherches (lm_queue_sends, tour du pilote) la balaieraient sinon
create index if not exists ix_lm_tasks_attempt_open
  on public.lm_tasks ((payload ->> 'attempt_id')) where status in ('queued', 'running');

-- Envois en file ou en cours d'une organisation (comparés à son solde de crédits)
create index if not exists ix_lm_tasks_account_send_open
  on public.lm_tasks (account_id) where kind = 'send' and status in ('queued', 'running');

-- Crédits de prise de contact déjà promis d'une organisation : formulaires des pilotes actifs en préparation,
-- validés ou en envoi, et formulaires validés à la main pas encore partis. Le pilote ne prépare jamais plus que
-- le solde moins ces réservations (plusieurs pilotes ou validations manuelles en parallèle).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_outreach_reserved(p_account_id uuid) returns integer
set search_path = ''
language sql
stable
security definer
as $$
  select ((select count(*) from public.lm_attempts a
             join public.lm_autopilots ap on ap.id = a.autopilot_id
            where ap.account_id = p_account_id and ap.status in ('preview', 'running', 'paused')
              and a.status in ('pending', 'preparing', 'validated', 'sending'))
        + (select count(*) from public.lm_attempts a
            where a.account_id = p_account_id and a.autopilot_id is null and a.status in ('validated', 'sending')))::integer;
$$;

revoke all on function public.lm_outreach_reserved(uuid) from public;

grant execute on function public.lm_outreach_reserved(uuid) to service_role;

-- Formulaire prêt sans aucun doute : ni alerte, ni protection, ni champ manquant. La seule remarque tolérée
-- est l'emploi de la version courte du message (zone de texte limitée), qui n'a rien de douteux.
-- Appelant : interne (appelée par d'autres fonctions SQL).
create or replace function public.lm_attempt_is_clean(
  p_status public.lm_attempt_status,
  p_detail text,
  p_protection_type text,
  p_missing jsonb
) returns boolean
set search_path = ''
language sql
immutable
as $$
  select p_status = 'ready'
     and p_protection_type is null
     and coalesce(jsonb_array_length(p_missing), 0) = 0
     and (p_detail is null or p_detail = 'version courte utilisée (zone de message limitée)');
$$;

grant execute on function public.lm_attempt_is_clean(public.lm_attempt_status, text, text, jsonb)
  to authenticated, service_role;

-- Prospects d'une campagne que le pilote peut contacter : jamais préparés (aucune tentative dans le dossier),
-- non exclus, avec un vrai site web. Même filtre que lm_prepare_campaign, sans les re-préparations.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_autopilot_contactable(p_campaign_id uuid) returns integer
set search_path = ''
language plpgsql
stable
security definer
as $$
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
$$;

revoke all on function public.lm_autopilot_contactable(uuid) from public;

grant execute on function public.lm_autopilot_contactable(uuid) to authenticated, service_role;

-- Fuseau horaire des entreprises d'une campagne : celui de la plus grande ville ciblée, sinon de la plus
-- grande ville du pays, sinon UTC.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_campaign_timezone(p_campaign_id uuid) returns text
set search_path = ''
language sql
stable
as $$
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
$$;

grant execute on function public.lm_campaign_timezone(uuid) to authenticated, service_role;

-- Heure de départ d'un nouvel envoi du pilote, d'après son rythme :
-- - continuous : tout de suite ;
-- - office : tout de suite pendant les heures de bureau (lundi-vendredi 9 h-18 h, heure locale), sinon à la
--   prochaine ouverture ;
-- - spread : ceil(target / spread_days) envois par jour ouvré, à intervalle régulier (9 h / quota) entre 9 h et
--   18 h : un envoi part au plus tôt un intervalle après le précédent du jour (pas de rafale au lancement ou
--   après une pause). Les envois déjà partis et ceux déjà en file pour un jour comptent dans son quota.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_autopilot_slot(p_autopilot_id uuid) returns timestamptz
set search_path = ''
language plpgsql
stable
security definer
as $$
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
$$;

revoke all on function public.lm_autopilot_slot(uuid) from public;

grant execute on function public.lm_autopilot_slot(uuid) to service_role;

-- Compteurs d'un passage du pilote : envoyés (partis), en cours (en préparation, validés en attente, en envoi),
-- prêts pour l'aperçu, mis de côté (tout le reste : douteux, sans formulaire, inaccessible, passé…).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_autopilot_counts(p_autopilot_id uuid)
returns table (sent integer, in_flight integer, preview_ready integer, aside integer, total integer)
set search_path = ''
language sql
stable
security definer
as $$
  select count(*) filter (where a.status in ('sent', 'to_verify'))::integer,
         count(*) filter (where a.status in ('pending', 'preparing', 'validated', 'sending'))::integer,
         count(*) filter (where public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))::integer,
         count(*) filter (where a.status not in ('sent', 'to_verify', 'pending', 'preparing', 'validated', 'sending')
                            and not public.lm_attempt_is_clean(a.status, a.detail, a.protection_type, a.missing))::integer,
         count(*)::integer
    from public.lm_attempts a
   where a.autopilot_id = p_autopilot_id;
$$;

-- Usage interne (tour du pilote, fonctions ci-dessous) : l'écran passe par lm_autopilot_summary
revoke all on function public.lm_autopilot_counts(uuid) from public;

grant execute on function public.lm_autopilot_counts(uuid) to service_role;

-- Nombre de formulaires préparés d'avance par pilote (le travail en file reste borné, quel que soit le nombre
-- choisi) et nombre de formulaires montrés dans l'aperçu.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_autopilot_ahead() returns integer
set search_path = ''
language sql
immutable
as $$ select 12 $$;

-- Nombre de formulaires montrés dans l'aperçu avant le premier envoi du pilote (3).
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_autopilot_preview_size() returns integer
set search_path = ''
language sql
immutable
as $$ select 3 $$;

grant execute on function public.lm_autopilot_ahead() to authenticated, service_role;

grant execute on function public.lm_autopilot_preview_size() to authenticated, service_role;

-- Un tour du pilote (robots d'envoi, via lm_queue_sends, et à chaque action de l'utilisateur) :
-- remet en file les préparations interrompues, prépare les prospects suivants dans l'ordre où ils ont été
-- trouvés (sans dépasser le nombre choisi ni les crédits), choisit le message de chacun (le moins utilisé
-- du passage, pour un test A/B à parts égales) et termine le passage quand c'est fini.
-- Un seul tour à la fois (verrou), les autres appels repartent aussitôt.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_autopilot_tick(p_only uuid default null) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_autopilot_tick(uuid) from public;

grant execute on function public.lm_autopilot_tick(uuid) to service_role;

-- Contrôles communs au lancement et à la modification. Erreurs (hint) : no_sender, no_messages, messages.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_autopilot_check(p_campaign_id uuid, p_messages text[]) returns public.lm_campaigns
set search_path = ''
language plpgsql
stable
security definer
as $$
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
   where pos <= 4 and length(trim(coalesce(m ->> 'body', ''))) > 0;

  if p_messages is null or cardinality(p_messages) = 0 or cardinality(p_messages) > 4
     or not (p_messages <@ coalesce(v_names, '{}'::text[])) then
    raise exception 'unknown message' using errcode = 'P0001', hint = 'messages';
  end if;

  return v_campaign;
end;
$$;

revoke all on function public.lm_autopilot_check(uuid, text[]) from public;

grant execute on function public.lm_autopilot_check(uuid, text[]) to service_role;

-- Lance le pilote sur une campagne (membre de l'organisation, tous les forfaits).
-- Le nombre est ramené aux prospects pas encore contactés et aux crédits de prise de contact disponibles.
-- Erreurs (hint) : not_found, no_sender, no_messages, messages, active, no_prospects, no_credits, schedule.
-- Appelant : interne (appelée par d'autres fonctions SQL).
create or replace function public.lm_start_autopilot(
  p_campaign_id uuid,
  p_target integer,
  p_messages text[],
  p_schedule public.lm_autopilot_schedule,
  p_spread_days integer,
  p_preview boolean
) returns uuid
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_start_autopilot(uuid, integer, text[], public.lm_autopilot_schedule, integer, boolean) from public;

grant execute on function public.lm_start_autopilot(uuid, integer, text[], public.lm_autopilot_schedule, integer, boolean)
  to authenticated, service_role;

-- Pilote actif d'une campagne, verrouillé, après contrôle d'appartenance (null si aucun)
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_autopilot_active(p_autopilot_id uuid) returns public.lm_autopilots
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_autopilot_active(uuid) from public;

grant execute on function public.lm_autopilot_active(uuid) to service_role;

-- Annule les tâches en file d'un passage : préparations (les tentatives restent « en attente » et repartent à la
-- reprise) et envois (les formulaires validés repassent « prêts », revalidés à la reprise : rien n'attend
-- « validé » pendant une pause, donc pas de fausse alerte du surveillant).
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_autopilot_hold(p_autopilot_id uuid, p_sends_only boolean) returns void
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_autopilot_hold(uuid, boolean) from public;

grant execute on function public.lm_autopilot_hold(uuid, boolean) to service_role;

-- Revalide les formulaires prêts sans doute d'un passage (confirmation de l'aperçu, reprise après pause)
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_autopilot_validate_clean(p_autopilot_id uuid) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_autopilot_validate_clean(uuid) from public;

grant execute on function public.lm_autopilot_validate_clean(uuid) to service_role;

-- Modifie un pilote actif : nombre, messages, moment d'envoi. Le nombre ne descend jamais sous ce qui est déjà
-- parti ou en cours, et ne dépasse pas ce qu'il reste de prospects et de crédits.
-- Appelant : interne (appelée par d'autres fonctions SQL).
create or replace function public.lm_update_autopilot(
  p_autopilot_id uuid,
  p_target integer,
  p_messages text[],
  p_schedule public.lm_autopilot_schedule,
  p_spread_days integer
) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_update_autopilot(uuid, integer, text[], public.lm_autopilot_schedule, integer) from public;

grant execute on function public.lm_update_autopilot(uuid, integer, text[], public.lm_autopilot_schedule, integer)
  to authenticated, service_role;

-- Pause / reprise / confirmation de l'aperçu / annulation de l'aperçu (membre de l'organisation)
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_pause_autopilot(p_autopilot_id uuid) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_pause_autopilot(uuid) from public;

grant execute on function public.lm_pause_autopilot(uuid) to authenticated, service_role;

-- Reprend un pilote en pause : les formulaires prêts et sans alerte repartent en validation.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_resume_autopilot(p_autopilot_id uuid) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_resume_autopilot(uuid) from public;

grant execute on function public.lm_resume_autopilot(uuid) to authenticated, service_role;

-- Confirme l'aperçu : les premiers formulaires partent et le pilote passe en marche.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_confirm_autopilot(p_autopilot_id uuid) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_confirm_autopilot(uuid) from public;

grant execute on function public.lm_confirm_autopilot(uuid) to authenticated, service_role;

-- Annuler l'aperçu : rien n'est parti. Les préparations pas encore commencées sont retirées (les prospects
-- redeviennent contactables), les formulaires déjà préparés restent visibles dans le mode Avancé.
-- Appelant : appli (utilisateur connecté).
create or replace function public.lm_cancel_autopilot(p_autopilot_id uuid) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_cancel_autopilot(uuid) from public;

grant execute on function public.lm_cancel_autopilot(uuid) to authenticated, service_role;

-- Tout ce que l'écran « Contacter » affiche, en une ligne : le dernier passage du pilote de la campagne
-- (colonnes vides s'il n'y en a jamais eu), ses compteurs, ce qu'il reste à contacter, les crédits, et si
-- l'organisation a déjà envoyé un message (sinon l'aperçu des 3 premiers formulaires est proposé coché).
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_autopilot_summary(p_campaign_id uuid)
returns table (
  autopilot_id uuid,
  status public.lm_autopilot_status,
  target integer,
  messages text[],
  schedule public.lm_autopilot_schedule,
  spread_days integer,
  timezone text,
  finished_reason text,
  started_at timestamptz,
  sent integer,
  in_flight integer,
  preview_ready integer,
  aside integer,
  next_send_at timestamptz,
  contactable integer,
  balance integer,
  contacted_before boolean
)
set search_path = ''
language plpgsql
stable
security definer
as $$
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
$$;

revoke all on function public.lm_autopilot_summary(uuid) from public;

grant execute on function public.lm_autopilot_summary(uuid) to authenticated, service_role;

-- Archive (ou désarchive) une campagne depuis l'appli (audit 5/11/2026, E18).
-- Appelant : appli (authenticated), contrôle lm_member. Archiver met la recherche en pause, arrête le pilote
-- automatique et retient les formulaires validés pas encore partis (ils repassent « prêts ») ; un envoi déjà en
-- cours se termine. Désarchiver remet la campagne en pause (ou en brouillon si elle n'a jamais été lancée) :
-- rien ne repart tout seul. Renvoie le nouveau statut.
create or replace function public.lm_set_campaign_archived(p_campaign_id uuid, p_archived boolean) returns text
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_status public.lm_campaign_status;
  ap record;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if p_archived then
    if v_campaign.status = 'archived' then
      return 'archived';
    end if;

    if v_campaign.status = 'running' then
      perform public.lm_pause_campaign(p_campaign_id, 'archived');
    end if;

    for ap in
      select id from public.lm_autopilots
       where campaign_id = p_campaign_id and status in ('preview', 'running', 'paused')
    loop
      perform public.lm_autopilot_hold(ap.id, false);
      update public.lm_autopilots set status = 'cancelled', finished_reason = 'archived', finished_at = now()
       where id = ap.id;
    end loop;

    -- formulaires validés à la main (hors pilote) pas encore partis
    update public.lm_tasks t set status = 'cancelled', finished_at = now()
     where t.kind = 'send' and t.status = 'queued'
       and t.payload ->> 'attempt_id' in (select a.id::text from public.lm_attempts a
                                           where a.campaign_id = p_campaign_id and a.status = 'validated');
    update public.lm_attempts set status = 'ready', validated_at = null, validated_by = null
     where campaign_id = p_campaign_id and status = 'validated';

    update public.lm_campaigns set status = 'archived' where id = p_campaign_id;

    return 'archived';
  end if;

  if v_campaign.status <> 'archived' then
    return v_campaign.status::text;
  end if;

  v_status := case when exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id)
                   then 'paused'::public.lm_campaign_status else 'draft'::public.lm_campaign_status end;

  update public.lm_campaigns set status = v_status, filters = filters - 'paused_reason' where id = p_campaign_id;

  return v_status::text;
end;
$$;

revoke all on function public.lm_set_campaign_archived(uuid, boolean) from public;

grant execute on function public.lm_set_campaign_archived(uuid, boolean) to authenticated, service_role;
