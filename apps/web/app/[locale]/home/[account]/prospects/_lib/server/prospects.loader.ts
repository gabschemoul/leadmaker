import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import {
  PROSPECTS_PAGE_SIZE,
  PROSPECT_SORT_COLUMNS,
  type ProspectSortDir,
  type ProspectSortKey,
  type ProspectsFilters,
  applyProspectsFilters,
} from '~/lib/leadmaker/prospects-query';

export { PROSPECTS_PAGE_SIZE };

type Client = SupabaseClient<Database>;

export interface ProspectsQuery {
  spaceId: string;
  page: number;
  sort: ProspectSortKey;
  dir: ProspectSortDir;
  filters: ProspectsFilters;
}

const LIST_COLUMNS =
  'id, name, category, city, rating, review_count, address, website, phone, found_email, email_checked_at, is_chain, source, excluded_at, created_at, campaign:lm_campaigns(id, name)';

/**
 * Une page de prospects d'un espace, avec le total pour la pagination.
 * Une seule requête (liste + total exact).
 */
export async function loadProspectsPage(
  client: Client,
  params: ProspectsQuery,
) {
  const from = (params.page - 1) * PROSPECTS_PAGE_SIZE;
  const column = PROSPECT_SORT_COLUMNS[params.sort];
  const ascending = params.dir === 'asc';

  const buildQuery = (columns: string, head = false) =>
    applyProspectsFilters(
      client
        .from('lm_prospects')
        .select(columns, { count: 'exact', head })
        .eq('space_id', params.spaceId),
      params.filters,
    );

  const { data, count, error } = await buildQuery(LIST_COLUMNS)
    // les valeurs manquantes (note, ville…) vont en fin de liste
    .order(column, { ascending, nullsFirst: false })
    .order('id', { ascending: true })
    .range(from, from + PROSPECTS_PAGE_SIZE - 1)
    .returns<ProspectListRow[]>();

  if (error) {
    // page au-delà de la dernière : PostgREST répond 416 sans total
    if (error.code === 'PGRST103') {
      const { count: total } = await buildQuery('id', true);

      return { prospects: [], total: total ?? 0 };
    }

    throw error;
  }

  return { prospects: data ?? [], total: count ?? 0 };
}

type ProspectRowBase = Database['public']['Tables']['lm_prospects']['Row'];

export type ProspectListRow = Pick<
  ProspectRowBase,
  | 'id'
  | 'name'
  | 'category'
  | 'city'
  | 'rating'
  | 'review_count'
  | 'address'
  | 'website'
  | 'phone'
  | 'found_email'
  | 'email_checked_at'
  | 'is_chain'
  | 'source'
  | 'excluded_at'
  | 'created_at'
> & {
  campaign: { id: string; name: string } | null;
};

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
