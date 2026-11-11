/*
 * -------------------------------------------------------
 * Section: LeadMaker nouveau parcours campagne (9/11/2026, CDC-PARCOURS-TRI-ANNUAIRE §3 et §6, étape 5)
 * Fonctions appelées par l'appli (écrans « Qui ? » et « Vos entreprises ») : cible en mots, offre du dossier,
 * choix du client sur les entreprises « À vérifier », résumé du tri. Contrôle d'accès lm_member sur chaque
 * identifiant reçu.
 * -------------------------------------------------------
 */

-- Fixe (ou change) la cible en mots d'une campagne et met en file le tri de ses entreprises (nouvelle cible :
-- tout est retrié, prix remesuré). Renvoie le nombre d'entreprises mises en file.
-- Erreurs (hint) : sort_target_required.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_set_sort_target(p_campaign_id uuid, p_target text) returns integer
set search_path = ''
language plpgsql
security definer
as $$
begin
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  return public.lm_start_sort(p_campaign_id, left(p_target, 500), null, null);
end;
$$;

revoke all on function public.lm_set_sort_target(uuid, text) from public;

grant execute on function public.lm_set_sort_target(uuid, text) to authenticated, service_role;

-- « Votre offre » d'un dossier (CDC §3.1) : texte court utilisé par le tri IA et « Proposer avec l'IA ».
-- Ne relance pas le tri des campagnes en cours (seules les entreprises triées ensuite en tiennent compte).
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_set_space_offer(p_space_id uuid, p_offer text) returns void
set search_path = ''
language plpgsql
security definer
as $$
begin
  update public.lm_spaces s
     set offer = left(nullif(trim(p_offer), ''), 1000)
   where s.id = p_space_id and public.lm_member(s.account_id);

  if not found then
    raise exception 'space not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.lm_set_space_offer(uuid, text) from public;

grant execute on function public.lm_set_space_offer(uuid, text) to authenticated, service_role;

-- « Votre offre » propre à une campagne (10/11/2026) ; null ou vide = celle du dossier. Comme pour l'offre du
-- dossier, les entreprises déjà triées ne sont pas retriées.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_set_campaign_offer(p_campaign_id uuid, p_offer text) returns void
set search_path = ''
language plpgsql
security definer
as $$
begin
  update public.lm_campaigns c
     set offer = left(nullif(trim(p_offer), ''), 1000)
   where c.id = p_campaign_id and public.lm_member(c.account_id);

  if not found then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.lm_set_campaign_offer(uuid, text) from public, anon;

grant execute on function public.lm_set_campaign_offer(uuid, text) to authenticated, service_role;

-- Écran « Vos entreprises » : le client garde ou écarte des entreprises « À vérifier » (jamais celles déjà
-- gardées ou écartées : pas de bouton « Écarter » dans « Gardées », décision du 9/11). Une entreprise gardée
-- ainsi est payée au prix de la campagne (CDC §4.2). Renvoie le nombre d'entreprises changées.
-- Erreurs (hint) : invalid_choice.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_choose_prospects(p_campaign_id uuid, p_prospect_ids uuid[], p_choice text)
returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_choose_prospects(uuid, uuid[], text) from public;

grant execute on function public.lm_choose_prospects(uuid, uuid[], text) to authenticated, service_role;

-- Résumé du tri d'une campagne pour l'écran « Vos entreprises » : cible, offre, nombre d'entreprises par onglet
-- (gardées = gardées par le tri ou par le client ; à vérifier = sans choix du client), en attente de tri, fiches
-- examinées par la recherche, prix d'une entreprise gardée. Les écartées ne sont jamais montrées au client.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_campaign_sort_summary(p_campaign_id uuid)
returns table (sort_target text, offer text, total integer, kept integer, to_check integer, pending integer,
               examined bigint, credits_per_prospect integer, price_pending boolean)
set search_path = ''
language plpgsql
stable
security definer
as $$
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
$$;

revoke all on function public.lm_campaign_sort_summary(uuid) from public;

grant execute on function public.lm_campaign_sort_summary(uuid) to authenticated, service_role;

-- Utilisation des fonctions d'IA de l'appli par organisation et par jour (heure UTC), pour les plafonds (CDC §6 :
-- « Proposer avec l'IA » limité à 30 propositions par jour et par compte). Écrite seulement par lm_take_ai_quota.
create table if not exists public.lm_ai_usage (
  account_id uuid references public.accounts(id) on delete cascade not null,
  day date not null,
  kind text not null,
  used integer not null default 0,
  primary key (account_id, day, kind)
);

comment on table public.lm_ai_usage is 'Appels aux fonctions d''IA de l''appli par organisation et par jour (plafonds)';

alter table public.lm_ai_usage enable row level security;

revoke all on public.lm_ai_usage from anon, authenticated, service_role;

grant select, insert, update, delete on table public.lm_ai_usage to service_role;

-- Prend une utilisation du plafond du jour pour une fonction d'IA : vrai si c'est permis (et compté), faux si le
-- plafond est atteint. Renvoie aussi ce qui reste.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_take_ai_quota(p_account_id uuid, p_kind text, p_limit integer)
returns table (allowed boolean, remaining integer)
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_used integer;
begin
  if not public.lm_member(p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  insert into public.lm_ai_usage as u (account_id, day, kind, used)
  values (p_account_id, (now() at time zone 'utc')::date, left(p_kind, 40), 1)
  on conflict (account_id, day, kind) do update set used = u.used + 1
    where u.used < greatest(p_limit, 0)
  returning u.used into v_used;

  if v_used is null then
    return query select false, 0;
  else
    return query select true, greatest(p_limit - v_used, 0);
  end if;
end;
$$;

revoke all on function public.lm_take_ai_quota(uuid, text, integer) from public;

grant execute on function public.lm_take_ai_quota(uuid, text, integer) to authenticated, service_role;

-- Groupes proposés par le robot de tri (§4.3) : enregistrés s'il n'y en a pas encore pour cette cible, puis
-- chaque entreprise gardée sans groupe est classée (tâches « sort » action 'group', Claude Haiku). Les entreprises
-- triées ensuite reçoivent leur groupe pendant le tri. p_groups : [{"key": "...", "label": "..."}], 2 à 5.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_set_sort_groups(p_campaign_id uuid, p_version integer, p_groups jsonb)
returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  -- 2 à 5 grands groupes, ou jusqu'à 20 groupes fins (lm_campaigns.sort_groups_fine)
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 2 and 20 then
    raise exception 'invalid groups' using errcode = 'P0001';
  end if;

  update public.lm_campaigns c set sort_groups = p_groups
   where c.id = p_campaign_id and c.sort_version = p_version and c.sort_groups = '[]'::jsonb;

  if not found then
    return 0;
  end if;

  -- Rangées « autre » avant que les groupes existent : à classer comme les autres
  update public.lm_campaign_prospects set group_key = null
   where campaign_id = p_campaign_id and group_key = 'autre';

  insert into public.lm_tasks (account_id, kind, payload, idempotency_key, priority)
  select cp.account_id, 'sort',
         jsonb_build_object('action', 'group', 'campaign_id', p_campaign_id, 'prospect_id', cp.prospect_id,
                            'version', p_version),
         'sortgroup:' || p_campaign_id::text || ':' || cp.prospect_id::text || ':' || p_version::text,
         -- avant le reste de la file de tri : l'encart des groupes s'affiche plus vite
         50
    from public.lm_campaign_prospects cp
   where cp.campaign_id = p_campaign_id and cp.sorted_version = p_version and cp.group_key is null
     and coalesce(cp.client_choice, cp.verdict) = 'gardee'
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.lm_set_sort_groups(uuid, integer, jsonb) from public;

grant execute on function public.lm_set_sort_groups(uuid, integer, jsonb) to service_role;

-- Groupe d'une entreprise (classement après coup) ; ignoré si la cible a changé ou si le groupe est inconnu.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_finish_sort_group(p_campaign_id uuid, p_prospect_id uuid, p_version integer,
                                                       p_group text) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
begin
  update public.lm_campaign_prospects cp set group_key = left(p_group, 60)
    from public.lm_campaigns c
   where cp.campaign_id = p_campaign_id and cp.prospect_id = p_prospect_id and c.id = cp.campaign_id
     and c.sort_version = p_version
     and (p_group = 'autre' or exists (select 1 from jsonb_array_elements(c.sort_groups) g where g ->> 'key' = p_group));

  return found;
end;
$$;

revoke all on function public.lm_finish_sort_group(uuid, uuid, integer, text) from public;

grant execute on function public.lm_finish_sort_group(uuid, uuid, integer, text) to service_role;

-- Encart des groupes : entreprises gardées par groupe (les groupes de la campagne, dans leur ordre, plus « autre »
-- et « sans groupe » pas encore classées), le choix déjà fait et le nombre total de gardées.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_campaign_groups(p_campaign_id uuid)
returns table (group_key text, label text, kept integer, total_kept integer, choice text)
set search_path = ''
language plpgsql
stable
security definer
as $$
declare
  v_campaign public.lm_campaigns%rowtype;
begin
  select * into v_campaign from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_campaign.id is null or v_campaign.sort_groups = '[]'::jsonb then
    return;
  end if;

  return query
  with kept as (
    select cp.group_key
      from public.lm_campaign_prospects cp
     where cp.campaign_id = p_campaign_id
       and coalesce(cp.client_choice, case when cp.sorted_version = v_campaign.sort_version then cp.verdict end) = 'gardee'
  )
  select g ->> 'key', g ->> 'label',
         (select count(*)::integer from kept k where k.group_key = g ->> 'key'),
         (select count(*)::integer from kept),
         v_campaign.groups_choice
    from jsonb_array_elements(v_campaign.sort_groups) with ordinality as x(g, o)
   order by o;
end;
$$;

revoke all on function public.lm_campaign_groups(uuid) from public;

grant execute on function public.lm_campaign_groups(uuid) to authenticated, service_role;

-- « Un seul message » (ou revenir sur ce choix : p_choice null).
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_set_groups_choice(p_campaign_id uuid, p_choice text) returns void
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_set_groups_choice(uuid, text) from public;

grant execute on function public.lm_set_groups_choice(uuid, text) to authenticated, service_role;


-- « Un message par groupe » (10/11/2026) : noms des messages de l'étape Message utilisables pour une entreprise
-- de ce groupe. Chaque message peut porter « group » (clé du groupe) ; sans « group » = « Pour les autres ».
--  * campagne en « Un message par groupe » : les messages du groupe, sinon ceux « Pour les autres », sinon tous ;
--  * sinon : les messages sans groupe, sinon tous.
-- Même règle de nom que le robot (« Message N » sans nom, texte non vide). null si aucun message.
-- Appelants : robots (préparation), lm_autopilot_tick ; rôle service.
create or replace function public.lm_campaign_message_names(p_campaign_id uuid, p_group text) returns text[]
set search_path = ''
language sql
stable
security definer
as $$
  with c as (
    select c.groups_choice,
           case when jsonb_typeof(c.templates) = 'array' then c.templates
                when jsonb_typeof(c.templates -> 'messages') = 'array' then c.templates -> 'messages'
                else '[]'::jsonb end as messages
      from public.lm_campaigns c where c.id = p_campaign_id
  ), m as (
    select coalesce(nullif(x ->> 'name', ''), 'Message ' || pos) as name, nullif(trim(x ->> 'group'), '') as grp, pos
      from c, jsonb_array_elements(c.messages) with ordinality as t(x, pos)
     where pos <= 84 and length(trim(coalesce(x ->> 'body', ''))) > 0
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
$$;

revoke all on function public.lm_campaign_message_names(uuid, text) from public, anon, authenticated;

grant execute on function public.lm_campaign_message_names(uuid, text) to service_role;


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

revoke all on function public.lm_campaign_group_results(uuid) from public, anon;

grant execute on function public.lm_campaign_group_results(uuid) to authenticated, service_role;

-- « Créer N campagnes » (§4.3) : une campagne par groupe (copie des réglages et du message de la campagne, en
-- brouillon, sans nouvelle recherche), qui reçoit les entreprises gardées de son groupe déjà trouvées (liens
-- campagne ↔ entreprise, déjà payées : rien n'est redébité) avec leur avis et leur raison. Chacune aura son propre
-- message. Renvoie les campagnes créées. Une seule fois par campagne.
-- Erreurs (hint) : no_groups, already_split.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_split_campaign_by_groups(p_campaign_id uuid)
returns table (campaign_id uuid, group_key text, label text, companies integer)
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_source public.lm_campaigns%rowtype;
  v_group jsonb;
  v_id uuid;
  v_count integer;
begin
  select * into v_source from public.lm_campaigns c where c.id = p_campaign_id for update;

  if v_source.id is null or not public.lm_member(v_source.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_source.sort_groups = '[]'::jsonb then
    raise exception 'no groups' using errcode = 'P0001', hint = 'no_groups';
  end if;

  if v_source.groups_choice = 'split' then
    raise exception 'already split' using errcode = 'P0001', hint = 'already_split';
  end if;

  for v_group in select g from jsonb_array_elements(v_source.sort_groups) g
  loop
    v_id := public.lm_duplicate_campaign(p_campaign_id,
                                         left(v_source.name || ' · ' || coalesce(v_group ->> 'label', v_group ->> 'key'), 255));

    -- Liens posés AVANT la cible : le déclencheur ne remet rien en file de tri (l'avis est recopié)
    insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, verdict, group_key, reason,
                                              sorted_at, sorted_version, client_choice, decided_at, credits, paid_at, gcid)
    select v_id, cp.prospect_id, cp.account_id, cp.space_id, cp.verdict, cp.group_key, cp.reason,
           cp.sorted_at, 1, cp.client_choice, cp.decided_at, 0, cp.paid_at, cp.gcid
      from public.lm_campaign_prospects cp
     where cp.campaign_id = p_campaign_id and cp.group_key = v_group ->> 'key' and cp.paid_at is not null
       and coalesce(cp.client_choice, case when cp.sorted_version = v_source.sort_version then cp.verdict end) = 'gardee';

    get diagnostics v_count = row_count;

    update public.lm_campaigns
       set sort_target = v_source.sort_target, sort_version = 1, sort_groups = jsonb_build_array(v_group),
           groups_choice = 'split', price_pending = false, credits_per_prospect = v_source.credits_per_prospect
     where id = v_id;

    campaign_id := v_id;
    group_key := v_group ->> 'key';
    label := v_group ->> 'label';
    companies := v_count;
    return next;
  end loop;

  update public.lm_campaigns set groups_choice = 'split' where id = p_campaign_id;
end;
$$;

revoke all on function public.lm_split_campaign_by_groups(uuid) from public;

grant execute on function public.lm_split_campaign_by_groups(uuid) to authenticated, service_role;

-- Plafonds d'une campagne (11/11/2026, écran « Qui ? », Paramètres avancés) : maximum de prospects gardés payés et
-- maximum de crédits dépensés ; null = pas de plafond. Monter un plafond n'efface pas la pause : « Reprendre ».
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_set_campaign_caps(p_campaign_id uuid, p_max_kept integer, p_max_credits integer)
returns void
set search_path = ''
language plpgsql
security definer
as $$
begin
  if not exists (select 1 from public.lm_campaigns c where c.id = p_campaign_id and public.lm_member(c.account_id)) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if (p_max_kept is not null and p_max_kept <= 0) or (p_max_credits is not null and p_max_credits <= 0) then
    raise exception 'invalid cap' using errcode = 'P0001', hint = 'invalid_cap';
  end if;

  update public.lm_campaigns set max_kept = p_max_kept, max_credits = p_max_credits where id = p_campaign_id;
end;
$$;

revoke all on function public.lm_set_campaign_caps(uuid, integer, integer) from public;

grant execute on function public.lm_set_campaign_caps(uuid, integer, integer) to authenticated, service_role;
