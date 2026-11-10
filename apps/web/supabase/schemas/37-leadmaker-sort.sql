/*
 * -------------------------------------------------------
 * Section: LeadMaker tri IA (9/11/2026, docs/prospectigo/CDC-PARCOURS-TRI-ANNUAIRE.md §4, étape 3)
 * Chaque entreprise d'une campagne qui a une cible en mots (lm_campaigns.sort_target) est triée par un robot
 * (tâche « sort ») : il lit la page d'accueil du site (gardée dans l'annuaire lm_places pour tous les clients),
 * puis Claude Haiku rend un avis : gardee | a_verifier | ecartee, un groupe et une raison courte.
 * « ecartee » reste interne : jamais montrée au client, jamais payée (décision du 9/11 : pas d'onglet
 * « Écartées »).
 * Crédit unique (§5, étape 4) : 1 crédit = 1 entreprise gardée, prise de contact comprise. Le prix d'une
 * entreprise gardée (1, 2 ou 4 crédits) est mesuré sur les premières entreprises triées (part de gardées), puis
 * figé ; les gardées pendant la mesure sont payées au palier final (lm_settle_kept). Sous 6 % de gardées, la
 * campagne se met en pause (« too_hard ») : le client doit préciser sa cible.
 * -------------------------------------------------------
 */

-- Nouvelle entreprise dans une campagne qui a une cible : tâche de tri en file.
-- Appelant : déclencheur (trigger) sur lm_campaign_prospects.
create or replace function public.lm_enqueue_sort() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
  select c.account_id, 'sort',
         jsonb_build_object('campaign_id', c.id, 'prospect_id', new.prospect_id, 'version', c.sort_version),
         'sort:' || c.id::text || ':' || new.prospect_id::text || ':' || c.sort_version::text
    from public.lm_campaigns c
   where c.id = new.campaign_id and nullif(trim(c.sort_target), '') is not null
  on conflict (idempotency_key) do nothing;

  return null;
end;
$$;

revoke all on function public.lm_enqueue_sort() from public;

create trigger lm_campaign_prospects_enqueue_sort
  after insert on public.lm_campaign_prospects
  for each row execute function public.lm_enqueue_sort();

-- Lance (ou relance) le tri d'une campagne : fixe la cible en mots et, si donnée, l'offre de son espace ; une
-- nouvelle cible ouvre une nouvelle version (les entreprises déjà triées le sont de nouveau). Met en file le
-- tri des entreprises de la campagne pas encore triées pour cette version ; p_limit : un échantillon (les
-- mêmes entreprises à chaque appel, ordre fixe) pour mesurer avant de tout trier. Renvoie le nombre de
-- tâches ajoutées.
-- Appelant : robots / scripts d'exploitation (rôle service). L'appli aura sa propre fonction (lot 5).
create or replace function public.lm_start_sort(
  p_campaign_id uuid, p_target text, p_offer text default null, p_limit integer default null
) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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

  -- offre donnée : celle de la campagne (10/11/2026 ; avant, celle du dossier)
  if nullif(trim(p_offer), '') is not null then
    update public.lm_campaigns set offer = left(trim(p_offer), 1000) where id = v_campaign.id;
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
$$;

revoke all on function public.lm_start_sort(uuid, text, text, integer) from public;

grant execute on function public.lm_start_sort(uuid, text, text, integer) to service_role;

-- Prix d'une entreprise gardée pour une part de gardées donnée (paliers lm_discovery_settings.sort_credit_tiers) ;
-- null sous le seuil de pause (sort_pause_rate).
-- Appelant : robots / serveur uniquement (rôle service), via lm_measure_sort_price.
create or replace function public.lm_credits_for_sort_rate(p_rate numeric) returns integer
set search_path = ''
language sql
stable
as $$
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
$$;

revoke all on function public.lm_credits_for_sort_rate(numeric) from public;

grant execute on function public.lm_credits_for_sort_rate(numeric) to service_role;

-- Mesure du prix d'une campagne triée (prix en attente) : dès que sort_measure_size entreprises sont triées pour
-- la cible en cours, la part de gardées fixe le prix (1 / 2 / 4 crédits), puis les entreprises gardées pendant la
-- mesure sont payées. Sous le seuil : pause « too_hard », le prix reste en attente (rien n'est payé).
-- Appelant : robots / serveur uniquement (rôle service), via lm_finish_sort.
create or replace function public.lm_measure_sort_price(p_campaign_id uuid) returns void
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_measure_sort_price(uuid) from public;

grant execute on function public.lm_measure_sort_price(uuid) to service_role;

-- Paiement des entreprises gardées (par le tri ou par le client) pas encore réglées d'une campagne au prix
-- figé (une seule si p_prospect_id). Une entreprise déjà payée par l'équipe dans une autre campagne n'est pas
-- redébitée (CDC §5.1). Crédits épuisés : la campagne se met en pause et les suivantes attendent. Renvoie le
-- nombre d'entreprises réglées.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_settle_kept(p_campaign_id uuid, p_prospect_id uuid default null) returns integer
set search_path = ''
language plpgsql
security definer
as $$
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
$$;

revoke all on function public.lm_settle_kept(uuid, uuid) from public;

grant execute on function public.lm_settle_kept(uuid, uuid) to service_role;

-- Résultat du tri d'une entreprise. Ignoré si la cible a changé entre-temps (version dépassée) ou si
-- l'entreprise n'est plus dans la campagne. Le texte du site est gardé dans l'annuaire (lm_places), pour ne
-- pas relire le site pour un autre client. Renvoie vrai si l'avis a été enregistré.
-- Appelant : robots / serveur uniquement (rôle service).
create or replace function public.lm_finish_sort(
  p_campaign_id uuid, p_prospect_id uuid, p_version integer, p_verdict text, p_group text, p_reason text,
  p_site_status text default null, p_site_text text default null
) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
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
             site_read_at = now(),
             -- site relu sans souci : il n'est plus mort (étape 3 de l'annuaire)
             site_dead_at = case when p_site_status = 'ok' then null else site_dead_at end
       where google_place_id = v_place_id;
    end if;
  end if;

  update public.lm_campaign_prospects cp
     set verdict = p_verdict,
         -- pas de groupe tant que la campagne n'en a pas (sinon tout serait rangé « autre » et jamais reclassé)
         group_key = case when (select jsonb_array_length(c.sort_groups) from public.lm_campaigns c
                                 where c.id = p_campaign_id) > 0
                          then left(nullif(trim(p_group), ''), 60) end,
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

    -- Groupes (§4.3) : assez de gardées et pas encore de groupes → une tâche de proposition (une par cible)
    -- groupes fins : 3 fois plus de gardées avant de proposer, pour voir aussi les sous-activités rares
    if (select c.sort_groups = '[]'::jsonb from public.lm_campaigns c where c.id = p_campaign_id)
       and (select count(*) from public.lm_campaign_prospects cp
             where cp.campaign_id = p_campaign_id and cp.sorted_version = p_version and cp.verdict = 'gardee')
           >= v_settings.sort_groups_after
              * (case when (select c.sort_groups_fine from public.lm_campaigns c where c.id = p_campaign_id) then 3 else 1 end) then
      insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
      select c.account_id, 'sort',
             jsonb_build_object('action', 'groups', 'campaign_id', c.id, 'version', p_version),
             'sortgroups:' || c.id::text || ':' || p_version::text
        from public.lm_campaigns c where c.id = p_campaign_id
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.lm_finish_sort(uuid, uuid, integer, text, text, text, text, text) from public;

grant execute on function public.lm_finish_sort(uuid, uuid, integer, text, text, text, text, text) to service_role;
