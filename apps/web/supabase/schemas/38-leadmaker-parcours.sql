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
