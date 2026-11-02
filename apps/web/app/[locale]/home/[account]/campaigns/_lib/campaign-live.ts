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
  const [campaign, progress, pricing, prospects] = await Promise.all([
    client
      .from('lm_campaigns')
      .select('status, filters')
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
  ]);

  if (campaign.error) throw campaign.error;
  if (progress.error) throw progress.error;
  if (prospects.error) throw prospects.error;

  const filters = (campaign.data.filters ?? {}) as Record<string, unknown>;
  const row = progress.data?.[0];
  // La pré-production partage la base de la production : tant que la migration du n°13 n'y est pas,
  // la fonction n'existe pas. On affiche alors « mesuré au lancement » plutôt que de casser la page.
  const price = pricing.error ? undefined : pricing.data?.[0];

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
      prospects: Number(row?.prospects ?? 0),
      lastSearchAt: row?.last_search_at ?? null,
    },
    /**
     * Tarif en crédits de prospection par prospect (roadmap n°13) : figé au lancement,
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
  };
}

export type CampaignLive = Awaited<ReturnType<typeof fetchCampaignLive>>;
