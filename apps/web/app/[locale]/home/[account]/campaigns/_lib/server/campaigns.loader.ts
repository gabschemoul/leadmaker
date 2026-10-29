import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

/** Campagnes de l'organisation, avec leur dossier client et le nombre de prospects trouvés. */
export async function loadCampaigns(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_campaigns')
    .select(
      'id, name, status, country_code, created_at, space_id, prospects:lm_prospects(count)',
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    countryCode: campaign.country_code,
    createdAt: campaign.created_at,
    spaceId: campaign.space_id,
    prospects: campaign.prospects?.[0]?.count ?? 0,
  }));
}

/** Une campagne (null si absente ou hors de l'organisation, grâce au RLS). */
export async function loadCampaign(client: Client, campaignId: string) {
  const { data, error } = await client
    .from('lm_campaigns')
    .select(
      'id, account_id, space_id, name, status, country_code, created_at, templates, auto_validation',
    )
    .eq('id', campaignId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Trois prospects récents de l'espace (avec site web) pour l'aperçu des
 * messages. Null-safe : un espace vide renvoie une liste vide.
 */
export async function loadPreviewProspects(client: Client, spaceId: string) {
  const { data, error } = await client
    .from('lm_prospects')
    .select('id, name, city, category, rating, review_count, website')
    .eq('space_id', spaceId)
    .is('excluded_at', null)
    .not('website', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3);

  if (error) {
    throw error;
  }

  return data ?? [];
}
