import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

const SENDER_COLUMNS =
  'id, civility, first_name, last_name, job_title, company, email, phone, website, address, zip, city, country_code, is_default, updated_at';

/**
 * Expéditeurs d'un espace : celui par défaut d'abord, puis du plus ancien au
 * plus récent. Plusieurs depuis le 3/11/2026 ; chaque campagne choisit le sien.
 */
export async function loadSenders(client: Client, spaceId: string) {
  const { data, error } = await client
    .from('lm_sender_profiles')
    .select(SENDER_COLUMNS)
    .eq('space_id', spaceId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export type SenderProfile = Awaited<ReturnType<typeof loadSenders>>[number];

/**
 * Expéditeur d'une campagne : celui qu'elle a choisi, sinon celui par défaut
 * de son espace (lm_campaign_sender). Null s'il n'y en a aucun.
 */
export async function loadCampaignSender(client: Client, campaignId: string) {
  const { data, error } = await client
    .rpc('lm_campaign_sender', { p_campaign_id: campaignId })
    .select(SENDER_COLUMNS)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}
