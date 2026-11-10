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
 * Valeurs présentes dans l'espace pour les filtres (activités, villes,
 * campagnes), avec leur nombre de prospects. Les campagnes sont renvoyées par
 * identifiant : leurs noms viennent de `loadSpaceCampaigns`.
 */
export async function loadProspectFacets(client: Client, spaceId: string) {
  const { data, error } = await client.rpc('lm_prospect_facets', {
    p_space_id: spaceId,
  });

  if (error) {
    throw error;
  }

  const facets = {
    categories: [] as ProspectFacet[],
    cities: [] as ProspectFacet[],
    campaigns: [] as ProspectFacet[],
  };

  for (const row of data ?? []) {
    const facet = { value: row.value, total: Number(row.total) };

    if (row.kind === 'category') facets.categories.push(facet);
    else if (row.kind === 'city') facets.cities.push(facet);
    else if (row.kind === 'campaign') facets.campaigns.push(facet);
  }

  return facets;
}

/** Noms des campagnes d'un espace, pour le filtre et la colonne « Campagne ». */
export async function loadSpaceCampaigns(client: Client, spaceId: string) {
  const { data, error } = await client
    .from('lm_campaigns')
    .select('id, name, status')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}
