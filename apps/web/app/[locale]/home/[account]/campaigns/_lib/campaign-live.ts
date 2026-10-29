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
  const [campaign, progress, prospects] = await Promise.all([
    client
      .from('lm_campaigns')
      .select('status, filters')
      .eq('id', campaignId)
      .single(),
    client.rpc('lm_campaign_progress', { p_campaign_id: campaignId }),
    client
      .from('lm_prospects')
      .select(
        'id, name, category, rating, review_count, address, website, phone, is_chain, created_at',
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
      prospects: Number(row?.prospects ?? 0),
      lastSearchAt: row?.last_search_at ?? null,
    },
    prospects: prospects.data ?? [],
  };
}

export type CampaignLive = Awaited<ReturnType<typeof fetchCampaignLive>>;
