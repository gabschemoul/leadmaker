/**
 * Une page de la liste Prospects (liste + total exact), interrogée côté serveur (premier affichage) ou dans le
 * navigateur (filtres, tri, pages : instantanés depuis le 10/11/2026, sans recharger la page). Protégé par la RLS.
 *
 * Partagé entre le serveur et le client : pas de `server-only`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import {
  PROSPECTS_PAGE_SIZE,
  PROSPECT_SORT_COLUMNS,
  type ProspectSortDir,
  type ProspectSortKey,
  type ProspectsFilters,
  applyProspectsFilters,
  sanitizeSearchTerm,
} from './prospects-query';

type Client = SupabaseClient<Database>;

export interface ProspectsQuery {
  spaceId: string;
  page: number;
  sort: ProspectSortKey;
  dir: ProspectSortDir;
  filters: ProspectsFilters;
}

// Contient toutes les colonnes de tri (PROSPECT_SORT_COLUMNS) : sur la fonction de recherche, PostgREST refuse de
// trier sur une colonne non sélectionnée.
const LIST_COLUMNS =
  'id, name, category, city, rating, review_count, address, website, phone, found_email, email_checked_at, is_chain, source, excluded_at, created_at, campaign:lm_campaigns!lm_prospects_campaign_id_fkey(id, name)';

/**
 * Une page de prospects d'un espace, avec le total pour la pagination.
 * Une seule requête (liste + total exact).
 */
export async function fetchProspectsPage(
  client: Client,
  params: ProspectsQuery,
) {
  const from = (params.page - 1) * PROSPECTS_PAGE_SIZE;
  const column = PROSPECT_SORT_COLUMNS[params.sort];
  const ascending = params.dir === 'asc';

  // texte cherché : la recherche passe par lm_search_prospects (index trigrammes, utilisables malgré la RLS :
  // 30 ms au lieu de 3 à 8 s sur 228 000 fiches), les autres filtres s'appliquent sur son résultat
  const term = params.filters.query
    ? sanitizeSearchTerm(params.filters.query)
    : '';

  const otherFilters = { ...params.filters, query: undefined };

  const buildQuery = (columns: string, head = false) =>
    term
      ? applyProspectsFilters(
          client
            .rpc(
              'lm_search_prospects',
              { p_space_id: params.spaceId, p_query: term },
              { count: 'exact', head, get: true },
            )
            .select(columns),
          otherFilters,
        )
      : applyProspectsFilters(
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
