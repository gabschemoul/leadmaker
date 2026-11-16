import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { PROSPECTS_PAGE_SIZE } from '~/lib/leadmaker/prospects-query';

export { PROSPECTS_PAGE_SIZE };

type Client = SupabaseClient<Database>;

export {
  type ProspectListRow,
  type ProspectsQuery,
  fetchProspectsPage as loadProspectsPage,
} from '~/lib/leadmaker/prospects-page-query';

export interface ProspectFacet {
  value: string;
  total: number;
}

/**
 * Valeurs présentes dans l'organisation pour les filtres (activités, villes,
 * campagnes), avec leur nombre de prospects : somme des compteurs de chacun de
 * ses espaces (lm_prospect_facets, un appel par espace, en parallèle). Les
 * campagnes sont renvoyées par identifiant : leurs noms viennent de
 * `loadAccountCampaigns`.
 */
export async function loadProspectFacets(client: Client, spaceIds: string[]) {
  const results = await Promise.all(
    spaceIds.map((spaceId) =>
      client.rpc('lm_prospect_facets', { p_space_id: spaceId }),
    ),
  );

  const totals = {
    category: new Map<string, number>(),
    city: new Map<string, number>(),
    campaign: new Map<string, number>(),
  };

  for (const { data, error } of results) {
    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      const kind = row.kind as keyof typeof totals;
      const map = totals[kind];

      if (map) {
        map.set(row.value, (map.get(row.value) ?? 0) + Number(row.total));
      }
    }
  }

  // les plus nombreux d'abord, puis par nom (même ordre que lm_prospect_facets)
  const toFacets = (map: Map<string, number>): ProspectFacet[] =>
    [...map.entries()]
      .map(([value, total]) => ({ value, total }))
      .sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));

  return {
    categories: toFacets(totals.category),
    cities: toFacets(totals.city),
    campaigns: toFacets(totals.campaign),
  };
}

/** Noms des campagnes de l'organisation, pour le filtre et la colonne « Campagne ». */
export async function loadAccountCampaigns(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_campaigns')
    .select('id, name, status')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}
