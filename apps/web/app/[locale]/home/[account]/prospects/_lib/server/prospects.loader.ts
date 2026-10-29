import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

export const PROSPECTS_PAGE_SIZE = 50;

export interface ProspectsQuery {
  spaceId: string;
  query: string;
  source: 'maps' | 'csv' | null;
  page: number;
}

/** Une page de prospects d'un espace, avec le total pour la pagination. */
export async function loadProspectsPage(
  client: SupabaseClient<Database>,
  params: ProspectsQuery,
) {
  const from = (params.page - 1) * PROSPECTS_PAGE_SIZE;

  const buildQuery = (columns: string, head = false) => {
    let request = client
      .from('lm_prospects')
      .select(columns, { count: 'exact', head })
      .eq('space_id', params.spaceId);

    if (params.query) {
      const escaped = params.query.replace(/[\\%_]/g, (char) => `\\${char}`);
      request = request.ilike('name', `%${escaped}%`);
    }

    if (params.source) {
      request = request.eq('source', params.source);
    }

    return request;
  };

  const { data, count, error } = await buildQuery(
    'id, name, category, rating, review_count, address, website, phone, is_chain, source, created_at',
  )
    .order('created_at', { ascending: false })
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
  | 'rating'
  | 'review_count'
  | 'address'
  | 'website'
  | 'phone'
  | 'is_chain'
  | 'source'
  | 'created_at'
>;
