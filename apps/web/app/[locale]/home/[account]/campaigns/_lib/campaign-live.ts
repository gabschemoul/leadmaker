import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

/**
 * Partie « vivante » d'une campagne : statut, avancement et derniers
 * prospects. Utilisée côté serveur pour le premier rendu, puis côté client
 * (React Query) pour le rafraîchissement toutes les 10 secondes.
 */
export async function fetchCampaignLive(
  client: SupabaseClient<Database>,
  campaignId: string,
) {
  const [
    campaign,
    progress,
    pricing,
    prospects,
    sortSummary,
    groups,
    money,
    phase,
  ] = await Promise.all([
    client
      .from('lm_campaigns')
      .select('status, filters, sort_target, sort_version')
      .eq('id', campaignId)
      .single(),
    client.rpc('lm_campaign_progress', { p_campaign_id: campaignId }),
    client.rpc('lm_campaign_pricing', { p_campaign_id: campaignId }),
    client
      .from('lm_prospects')
      .select(
        'id, name, category, city, rating, review_count, address, website, phone, found_email, is_chain, source, excluded_at, created_at',
      )
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(50),
    // écran « Vos entreprises » (campagne triée) : nombres par onglet, fiches examinées, prix
    client.rpc('lm_campaign_sort_summary', { p_campaign_id: campaignId }),
    // groupes proposés par le tri (CDC §4.3) : gardées par groupe et choix du client ; vide sans groupes
    client.rpc('lm_campaign_groups', { p_campaign_id: campaignId }),
    // argent de la campagne montré dans le parcours (analyse UX E-01 / T-03)
    client.rpc('lm_campaign_money', { p_campaign_id: campaignId }),
    // où en est le lancement (« 0 recherche faite » pendant 1 à 2 minutes, retour du 11/11)
    client.rpc('lm_campaign_search_phase', { p_campaign_id: campaignId }),
  ]);

  if (campaign.error) throw campaign.error;
  if (progress.error) throw progress.error;
  if (prospects.error) throw prospects.error;

  const filters = (campaign.data.filters ?? {}) as Record<string, unknown>;
  const row = progress.data?.[0];
  // La pré-production partage la base de la production : tant que la migration du n°13 n'y est pas,
  // la fonction n'existe pas. On affiche alors « mesuré au lancement » plutôt que de casser la page.
  const price = pricing.error ? undefined : pricing.data?.[0];
  const sortTarget = campaign.data.sort_target?.trim() || null;
  const summary = sortSummary.error ? undefined : sortSummary.data?.[0];
  // même prudence : sans la fonction des groupes en base, l'encart ne s'affiche simplement pas
  const groupRows = groups.error ? [] : (groups.data ?? []);
  // même prudence : tant que la migration du 11/11 n'est pas en base, on montre seulement le prix
  const moneyRow = money.error ? undefined : money.data?.[0];
  // même prudence (migration du 11/11 « search_progress ») : sans la fonction, pas de phase affichée
  const phaseRow = phase.error ? undefined : phase.data?.[0];

  return {
    status: campaign.data.status,
    pausedReason:
      typeof filters.paused_reason === 'string' ? filters.paused_reason : null,
    progress: {
      zones: row?.zones ?? 0,
      categories: row?.categories ?? 0,
      searchesTotal: Number(row?.searches_total ?? 0),
      searchesDone: Number(row?.searches_done ?? 0),
      inFlight: Number(row?.in_flight ?? 0),
      abandoned: row?.abandoned ?? 0,
      productive: row?.productive ?? 0,
      // campagne triée (crédit unique) : les entreprises trouvées, pas les débits de l'ancien tarif (toujours 0 ici,
      // d'où « Aucun prospect pour l'instant » à l'étape Envoi alors que la recherche en avait trouvé, 11/11)
      prospects:
        sortTarget && summary
          ? (summary.total ?? 0)
          : Number(row?.prospects ?? 0),
      lastSearchAt: row?.last_search_at ?? null,
      /** recherches en file / en cours, recherches d'autres campagnes avant, reprise prévue, mesure du prix */
      phase: phaseRow
        ? {
            queued: phaseRow.queued ?? 0,
            running: phaseRow.running ?? 0,
            ahead: phaseRow.ahead ?? 0,
            resumeAt: phaseRow.resume_at ?? null,
            estimateDone: phaseRow.estimate_done ?? null,
            estimateTotal: phaseRow.estimate_total ?? null,
          }
        : null,
    },
    /**
     * Tarif en crédits par prospect (roadmap n°13) : figé au lancement,
     * sinon celui de la dernière estimation faite avec ce ciblage (terminée ou en cours).
     */
    pricing: {
      frozen: price?.frozen ?? false,
      creditsPerProspect: price?.credits_per_prospect ?? null,
      rate: price?.rate ?? null,
      estimateStatus: price?.estimate_status ?? null,
      doneSearches: price?.done_searches ?? 0,
      sampleSearches: price?.sample_searches ?? 0,
    },
    prospects: prospects.data ?? [],
    /**
     * Crédits de la campagne (analyse UX E-01 / T-03) : utilisés par la campagne et disponibles pour
     * l'organisation ; null tant que la fonction n'existe pas en base.
     */
    money: moneyRow
      ? {
          spent: moneyRow.spent ?? 0,
          available: moneyRow.available ?? 0,
        }
      : null,
    /**
     * Tri selon la cible en mots (nouveau parcours, CDC-PARCOURS-TRI-ANNUAIRE §6) ; null pour une campagne
     * sans cible (ancien parcours, écran « Trouver » inchangé).
     */
    sort: sortTarget
      ? {
          target: sortTarget,
          version: campaign.data.sort_version,
          total: summary?.total ?? 0,
          kept: summary?.kept ?? 0,
          toCheck: summary?.to_check ?? 0,
          pending: summary?.pending ?? 0,
          examined: Number(summary?.examined ?? 0),
          creditsPerProspect: summary?.credits_per_prospect ?? 1,
          pricePending: summary?.price_pending ?? true,
        }
      : null,
    /**
     * Groupes de la campagne (encart « Un message par groupe ? » de « Vos entreprises ») : liste vide tant que
     * le tri n'a pas proposé de groupes. choice : null (pas encore choisi), 'per_group' (un message par groupe,
     * dans cette même campagne), 'single' ou 'split' (ancien choix : une campagne par groupe, plus proposé).
     */
    groups: {
      choice: (groupRows[0]?.choice ?? null) as
        | 'per_group'
        | 'single'
        | 'split'
        | null,
      totalKept: groupRows[0]?.total_kept ?? 0,
      list: groupRows.map((row) => ({
        key: row.group_key,
        label: row.label || row.group_key,
        kept: row.kept ?? 0,
      })),
    },
  };
}

export type CampaignLive = Awaited<ReturnType<typeof fetchCampaignLive>>;
