import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

/** Onglets de l'écran « Vos entreprises » (jamais d'onglet « Écartées »). */
export type CompaniesTab = 'kept' | 'toCheck';

/** Entreprises lues par page (« Afficher plus » charge la suivante). */
export const COMPANIES_PAGE_SIZE = 50;

/**
 * Une page d'entreprises triées d'une campagne (lm_campaign_prospects, lisible par les membres grâce à la
 * RLS), les plus récemment triées d'abord, avec le nom et la ville de l'entreprise et la raison courte du tri.
 * - Gardées : gardées par le client, ou par le tri pour la cible en cours (`version`) sans choix du client.
 * - À vérifier : « à vérifier » pour la cible en cours, sans choix du client.
 * Les entreprises écartées ne sont jamais lues.
 */
export async function fetchSortedCompanies(
  client: Client,
  params: {
    campaignId: string;
    version: number;
    tab: CompaniesTab;
    page: number;
  },
) {
  const from = params.page * COMPANIES_PAGE_SIZE;

  let query = client
    .from('lm_campaign_prospects')
    .select(
      'prospect_id, reason, sorted_at, prospect:lm_prospects(name, city, website)',
    )
    .eq('campaign_id', params.campaignId);

  query =
    params.tab === 'kept'
      ? query.or(
          `client_choice.eq.gardee,and(client_choice.is.null,verdict.eq.gardee,sorted_version.eq.${params.version})`,
        )
      : query
          .is('client_choice', null)
          .eq('verdict', 'a_verifier')
          .eq('sorted_version', params.version);

  const { data, error } = await query
    .order('sorted_at', { ascending: false, nullsFirst: false })
    .order('prospect_id', { ascending: true })
    .range(from, from + COMPANIES_PAGE_SIZE - 1);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.prospect_id,
    name: row.prospect?.name ?? '',
    city: row.prospect?.city ?? null,
    website: row.prospect?.website ?? null,
    reason: row.reason,
  }));
}

export type SortedCompany = Awaited<
  ReturnType<typeof fetchSortedCompanies>
>[number];
