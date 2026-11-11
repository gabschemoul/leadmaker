-- Analyse UX du 11/11/2026, problèmes graves (P0) réglés en base :
--  S-01 : prix d'une petite campagne fixé en fin de recherche, provisoire jusqu'à sort_measure_size triées
--         (lm_campaigns.price_sample, lm_measure_sort_price + déclencheur de fin de recherche) ;
--  S-02 : gardées en attente de crédits réglées dès que des crédits arrivent (lm_settle_account_kept +
--         déclencheurs, jamais bloquants) ; solde verrouillé avant « déjà payée ailleurs » (lm_settle_kept) ;
--  S-08 : le pilote attend les nouvelles gardées tant que la recherche ou le tri avancent (lm_autopilot_tick) ;
--  E-01 / T-03 : crédits d'une campagne pour l'écran (lm_campaign_money).
-- Compatible avec le code de main : une colonne ajoutée, aucune signature existante changée.

alter table public.lm_campaigns add column if not exists price_sample integer;

-- Mesure du prix d'une campagne triée (prix en attente) : dès que sort_measure_size entreprises sont triées pour
-- la cible en cours, la part de gardées fixe le prix (1 / 2 / 4 crédits), puis les entreprises gardées pendant la
-- mesure sont payées. Sous le seuil : pause « too_hard », le prix reste en attente (rien n'est payé).
-- Petite campagne (analyse UX S-01, 11/11/2026) : recherche terminée et tout trié avant sort_measure_size
-- entreprises → le prix est fixé sur ce qui a été trié (1 crédit sous 50 triées, trop peu pour mesurer ; sous le
-- seuil de pause, le palier le plus cher : une recherche finie n'a plus rien à mettre en pause). Avant, le prix
-- restait en attente pour toujours : aucune gardée n'était payée ni contactée. Ce prix est provisoire
-- (price_sample) : si la campagne grandit jusqu'à sort_measure_size triées, il est remesuré.
-- Appelant : robots / serveur uniquement (rôle service), via lm_finish_sort et le déclencheur de fin de recherche.
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
  v_small boolean := false;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  if nullif(trim(v_campaign.sort_target), '') is null then
    return;
  end if;

  select sort_measure_size into v_size from public.lm_discovery_settings where id;

  -- Prix déjà mesuré sur assez d'entreprises : définitif (seul un prix provisoire de petite campagne se remesure)
  if not v_campaign.price_pending and coalesce(v_campaign.price_sample, v_size) >= v_size then
    return;
  end if;

  select count(*), count(*) filter (where coalesce(cp.client_choice, cp.verdict) = 'gardee')
    into v_sorted, v_kept
    from public.lm_campaign_prospects cp
   where cp.campaign_id = p_campaign_id and cp.sorted_version = v_campaign.sort_version;

  if v_sorted < v_size then
    -- Petite campagne : seulement si le prix attend encore (ou si la campagne a grandi depuis un prix
    -- provisoire), que plus rien n'est à trier et que la recherche est finie. Le statut est relu sous verrou : la fin de recherche (planificateur) et le dernier tri (robot) sont
    -- deux transactions ; sans verrou, chacune pouvait manquer l'écriture de l'autre et le prix restait en
    -- attente pour toujours.
    if v_sorted = 0
       or not (v_campaign.price_pending or coalesce(v_campaign.price_sample, v_size) < v_sorted)
       or exists (select 1 from public.lm_campaign_prospects cp
                   where cp.campaign_id = p_campaign_id
                     and cp.sorted_version is distinct from v_campaign.sort_version) then
      return;
    end if;

    select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

    if v_campaign.status <> 'completed'
       or not (v_campaign.price_pending or coalesce(v_campaign.price_sample, v_size) < v_sorted) then
      return;
    end if;

    v_small := true;
  else
    -- Un seul passage fixe le prix (plusieurs robots trient en même temps)
    select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

    if not v_campaign.price_pending and coalesce(v_campaign.price_sample, v_size) >= v_size then
      return;
    end if;
  end if;

  v_credits := public.lm_credits_for_sort_rate(v_kept::numeric / v_sorted);

  if v_small then
    -- sous le seuil de pause : le palier le plus cher, lu par la même règle (part = seuil de pause)
    v_credits := case when v_sorted < 50 then 1
                      else coalesce(v_credits, public.lm_credits_for_sort_rate(
                             (select ds.sort_pause_rate from public.lm_discovery_settings ds where ds.id))) end;
  end if;

  if v_credits is null then
    if v_campaign.status = 'running' then
      perform public.lm_pause_campaign(p_campaign_id, 'too_hard');
    end if;
    return;
  end if;

  -- Prix provisoire remesuré : les entreprises déjà payées le restent, les suivantes paient le nouveau prix
  update public.lm_campaigns
     set credits_per_prospect = v_credits, price_pending = false, price_sample = v_sorted
   where id = p_campaign_id;

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

  -- Solde de l'organisation verrouillé AVANT de regarder si l'entreprise est déjà payée ailleurs : deux règlements
  -- simultanés de la même entreprise dans deux campagnes (robot de tri + recharge qui règle l'attente) se suivent
  -- au lieu de la débiter deux fois (relecture du 11/11/2026)
  perform 1 from public.lm_account_credits where account_id = v_campaign.account_id for update;

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

-- Fin de recherche d'une campagne triée : le prix d'une petite campagne (moins de sort_measure_size entreprises)
-- se fixe ici quand le dernier tri a eu lieu avant la fin de la recherche (analyse UX S-01).
-- Appelant : déclencheur (trigger) sur lm_campaigns.
create or replace function public.lm_campaign_completed_measure() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  perform public.lm_measure_sort_price(new.id);
  return null;
end;
$$;

revoke all on function public.lm_campaign_completed_measure() from public, anon, authenticated;

create or replace trigger lm_campaigns_completed_measure
  after update of status on public.lm_campaigns
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.lm_campaign_completed_measure();

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

    -- Rien trouvé et plus rien en cours (analyse UX S-08 et S-09, 11/11/2026) :
    --  * le curseur n'est qu'un raccourci : une entreprise payée après son passage (gardée après coup, réglée
    --    après une recharge) est derrière lui. Il repart donc du début, et le tour suivant relit toute la
    --    campagne avec la même règle que ci-dessus (une seule règle, pas de copie) ;
    --  * curseur déjà au début et toujours rien : tant que la campagne apporte encore des entreprises (recherche
    --    en cours, tri en file, tri qui avance depuis moins de 5 min), le pilote attend au lieu de se déclarer
    --    terminé ; une recherche en pause ou un tri en échec ne le fait pas attendre ;
    --  * sinon, passage terminé.
    if ap.status = 'running' and v_want > 0 and v_found = 0 and c.in_flight = 0 then
      if v_cursor_id is not null then
        update public.lm_autopilots set cursor_created_at = null, cursor_prospect_id = null where id = ap.id;
      elsif not exists (
           select 1 from public.lm_campaigns sc
            where sc.id = ap.campaign_id
              and (sc.status = 'running'
                   or exists (select 1 from public.lm_tasks t
                               where t.kind = 'sort' and t.status = 'queued'
                                 and t.payload ->> 'campaign_id' = sc.id::text)
                   or exists (select 1 from public.lm_campaign_prospects cp
                               where cp.campaign_id = sc.id and cp.sorted_at > now() - interval '5 minutes'))) then
        update public.lm_autopilots set status = 'done', finished_reason = 'no_prospects', finished_at = now()
         where id = ap.id and status = 'running';
      end if;
    end if;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.lm_autopilot_tick(uuid) from public;

grant execute on function public.lm_autopilot_tick(uuid) to service_role;

-- Paiement des entreprises gardées restées en attente de crédits, dans toutes les campagnes (non archivées, prix
-- fixé) d'une organisation. Sans ça, une gardée arrivée pendant une panne de crédits n'était jamais réglée, donc
-- jamais contactée, même après une recharge (analyse UX S-02, 11/11/2026). Renvoie le nombre de gardées réglées.
-- Appelant : déclencheurs (recharge du forfait, achat d'un pack) ; robots / serveur uniquement (rôle service).
create or replace function public.lm_settle_account_kept(p_account_id uuid) returns integer
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_campaign uuid;
  v_count integer := 0;
begin
  for v_campaign in
    select c.id
      from public.lm_campaigns c
     where c.account_id = p_account_id and c.status <> 'archived' and not c.price_pending
       and nullif(trim(c.sort_target), '') is not null
       and exists (select 1 from public.lm_campaign_prospects cp
                    where cp.campaign_id = c.id and cp.paid_at is null
                      and coalesce(cp.client_choice, cp.verdict) = 'gardee')
     order by c.created_at
  loop
    v_count := v_count + public.lm_settle_kept(v_campaign, null);

    -- crédits de nouveau épuisés : inutile d'essayer les campagnes suivantes (somme écrite ici :
    -- lm_available_credits renvoie null hors d'une session membre ou service, par exemple sous pg_cron)
    exit when coalesce((select ac.discovery_balance from public.lm_account_credits ac where ac.account_id = p_account_id), 0)
              + public.lm_pack_credits(p_account_id) <= 0;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.lm_settle_account_kept(uuid) from public, anon, authenticated;

grant execute on function public.lm_settle_account_kept(uuid) to service_role;

-- Crédits ajoutés (forfait renouvelé ou rechargé, pack acheté) : les gardées en attente sont réglées tout de suite.
-- Jamais bloquant : ces écritures viennent du paiement Stripe ou de la recharge mensuelle ; si le règlement
-- échoue, il est annulé seul (bloc d'exception) et les crédits restent acquis.
-- Appelant : déclencheurs (trigger) sur lm_account_credits et lm_credit_packs.
create or replace function public.lm_credits_added_settle() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  begin
    perform public.lm_settle_account_kept(new.account_id);
  exception when others then
    raise warning 'lm_credits_added_settle %: %', new.account_id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.lm_credits_added_settle() from public, anon, authenticated;

-- seulement quand le solde monte (un débit le fait baisser : jamais de boucle débit → règlement → débit)
create or replace trigger lm_account_credits_added_settle
  after update of discovery_balance on public.lm_account_credits
  for each row
  when (new.discovery_balance > old.discovery_balance)
  execute function public.lm_credits_added_settle();

create or replace trigger lm_account_credits_created_settle
  after insert on public.lm_account_credits
  for each row
  when (new.discovery_balance > 0)
  execute function public.lm_credits_added_settle();

create or replace trigger lm_credit_packs_added_settle
  after insert on public.lm_credit_packs
  for each row
  execute function public.lm_credits_added_settle();

-- Argent d'une campagne, montré dans le parcours (analyse UX E-01 / T-03, 11/11/2026) : crédits déjà utilisés par
-- la campagne, crédits disponibles de l'organisation (forfait + packs). Le prix d'une gardée vient de
-- lm_campaign_sort_summary. Rien pour un non-membre.
-- Appelant : appli (utilisateur connecté), contrôle d'accès lm_member.
create or replace function public.lm_campaign_money(p_campaign_id uuid)
returns table (spent integer, available integer)
set search_path = ''
language sql
stable
security definer
as $$
  select (select coalesce(sum(cp.credits), 0)::integer from public.lm_campaign_prospects cp
           where cp.campaign_id = c.id),
         coalesce((select ac.discovery_balance from public.lm_account_credits ac where ac.account_id = c.account_id), 0)
           + public.lm_pack_credits(c.account_id)
    from public.lm_campaigns c
   where c.id = p_campaign_id and public.lm_member(c.account_id);
$$;

revoke all on function public.lm_campaign_money(uuid) from public, anon;

grant execute on function public.lm_campaign_money(uuid) to authenticated, service_role;
