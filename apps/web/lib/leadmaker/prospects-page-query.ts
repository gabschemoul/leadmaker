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
} from './prospects-query';

type Client = SupabaseClient<Database>;

export interface ProspectsQuery {
  spaceId: string;
  page: number;
  sort: ProspectSortKey;
  dir: ProspectSortDir;
  filters: ProspectsFilters;
}

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
