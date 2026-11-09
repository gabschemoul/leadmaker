/*
 * -------------------------------------------------------
 * Section: LeadMaker tri IA (9/11/2026, docs/prospectigo/CDC-PARCOURS-TRI-ANNUAIRE.md §4, étape 3)
 * Chaque entreprise d'une campagne qui a une cible en mots (lm_campaigns.sort_target) est triée par un robot
 * (tâche « sort ») : il lit la page d'accueil du site (gardée dans l'annuaire lm_places pour tous les clients),
 * puis Claude Haiku rend un avis : gardee | a_verifier | ecartee, un groupe et une raison courte.
 * « ecartee » reste interne : jamais montrée au client, jamais payée (décision du 9/11 : pas d'onglet
 * « Écartées »). Étape 3 = mesure seulement : le prix et les écrans ne changent pas.
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
    update public.lm_campaigns set sort_target = v_target, sort_version = sort_version + 1
     where id = p_campaign_id
     returning * into v_campaign;
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
$$;

revoke all on function public.lm_start_sort(uuid, text, text, integer) from public;

grant execute on function public.lm_start_sort(uuid, text, text, integer) to service_role;

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
     and p_version = (select c.sort_version from public.lm_campaigns c where c.id = p_campaign_id);

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.lm_finish_sort(uuid, uuid, integer, text, text, text, text, text) from public;

grant execute on function public.lm_finish_sort(uuid, uuid, integer, text, text, text, text, text) to service_role;
