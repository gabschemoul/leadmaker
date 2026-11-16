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
  /** espaces de l'organisation, l'espace par défaut en premier (loadSpaceIds) : la liste les réunit tous */
  spaceIds: string[];
  page: number;
  sort: ProspectSortKey;
  dir: ProspectSortDir;
  filters: ProspectsFilters;
}

// Contient toutes les colonnes de tri (PROSPECT_SORT_COLUMNS) : sur la fonction de recherche, PostgREST refuse de
// trier sur une colonne non sélectionnée.
const LIST_COLUMNS =
  'id, name, category, city, rating, review_count, address, website, phone, found_email, email_checked_at, is_chain, source, excluded_at, created_at, campaign:lm_campaigns!lm_prospects_campaign_id_fkey(id, name)';

// Lignes renvoyées au plus par la base en une réponse (max_rows de l'API) : au-delà, la fusion ne s'applique plus.
const MERGE_ROWS_LIMIT = 1000;

/**
 * Une page de prospects de toute l'organisation, avec le total pour la pagination.
 *
 * Une seule requête quand l'organisation n'a qu'un espace (presque toutes). Sinon (dossiers clients d'avant le
 * 16/11/2026, plus affichés) : l'espace par défaut et les autres sont lus à part puis fusionnés dans l'ordre du
 * tri. Chaque partie garde ainsi ses index par espace (liste de l'espace par défaut en 4 ms, contre 0,5 à 1,3 s
 * pour une requête sur toute l'organisation de 310 000 fiches, mesuré le 16/11/2026). Au-delà de la 20e page, une
 * requête sur tous les espaces (plus lente, environ 0,5 s).
 */
export async function fetchProspectsPage(
  client: Client,
  params: ProspectsQuery,
) {
  const from = (params.page - 1) * PROSPECTS_PAGE_SIZE;
  const [mainSpaceId, ...otherSpaceIds] = params.spaceIds;

  if (!mainSpaceId) {
    return { prospects: [] as ProspectListRow[], total: 0 };
  }

  if (otherSpaceIds.length === 0) {
    return fetchSlice(client, params, [mainSpaceId], from, PROSPECTS_PAGE_SIZE);
  }

  const needed = from + PROSPECTS_PAGE_SIZE;

  if (needed > MERGE_ROWS_LIMIT) {
    return fetchSlice(
      client,
      params,
      params.spaceIds,
      from,
      PROSPECTS_PAGE_SIZE,
    );
  }

  const [main, others] = await Promise.all([
    fetchSlice(client, params, [mainSpaceId], 0, needed),
    fetchSlice(client, params, otherSpaceIds, 0, needed),
  ]);

  const compare = compareRows(PROSPECT_SORT_COLUMNS[params.sort], params.dir);

  return {
    prospects: mergeSorted(main.prospects, others.prospects, compare).slice(
      from,
      needed,
    ),
    total: main.total + others.total,
  };
}

/** `size` prospects à partir du rang `from`, dans l'ordre du tri, sur les espaces donnés ; et leur total. */
async function fetchSlice(
  client: Client,
  params: ProspectsQuery,
  spaceIds: string[],
  from: number,
  size: number,
) {
  const column = PROSPECT_SORT_COLUMNS[params.sort];
  const ascending = params.dir === 'asc';

  // texte cherché dans un seul espace : la recherche passe par lm_search_prospects (index trigrammes,
  // utilisables malgré la RLS : 30 ms au lieu de 3 à 8 s sur 228 000 fiches), les autres filtres s'appliquent
  // sur son résultat. Sur plusieurs espaces (les petits espaces hors défaut), recherche directe.
  const term = params.filters.query
    ? sanitizeSearchTerm(params.filters.query)
    : '';

  const otherFilters = { ...params.filters, query: undefined };

  const buildQuery = (columns: string, head = false) => {
    if (term && spaceIds.length === 1) {
      return applyProspectsFilters(
        client
          .rpc(
            'lm_search_prospects',
            { p_space_id: spaceIds[0]!, p_query: term },
            { count: 'exact', head, get: true },
          )
          .select(columns),
        otherFilters,
      );
    }

    const base = client
      .from('lm_prospects')
      .select(columns, { count: 'exact', head });

    return applyProspectsFilters(
      spaceIds.length === 1
        ? base.eq('space_id', spaceIds[0]!)
        : base.in('space_id', spaceIds),
      params.filters,
    );
  };

  const { data, count, error } = await buildQuery(LIST_COLUMNS)
    // les valeurs manquantes (note, ville…) vont en fin de liste
    .order(column, { ascending, nullsFirst: false })
    .order('id', { ascending: true })
    .range(from, from + size - 1)
    .returns<ProspectListRow[]>();

  if (error) {
    // page au-delà de la dernière : PostgREST répond 416 sans total
    if (error.code === 'PGRST103') {
      const { count: total } = await buildQuery('id', true);

      return { prospects: [] as ProspectListRow[], total: total ?? 0 };
    }

    throw error;
  }

  return { prospects: data ?? [], total: count ?? 0 };
}

/**
 * Ordre de la liste, comme en base : colonne de tri (valeurs manquantes en fin), puis identifiant croissant.
 * Fusion de deux listes déjà triées par la base : même si une comparaison de textes différait légèrement de
 * celle de la base, la fusion reste la même d'une page à l'autre (aucune fiche en double ni oubliée).
 */
function compareRows(column: string, dir: ProspectSortDir) {
  const sign = dir === 'asc' ? 1 : -1;

  return (a: ProspectListRow, b: ProspectListRow) => {
    const left = (a as Record<string, unknown>)[column];
    const right = (b as Record<string, unknown>)[column];
    const leftMissing = left === null || left === undefined;
    const rightMissing = right === null || right === undefined;

    if (leftMissing !== rightMissing) {
      return leftMissing ? 1 : -1;
    }

    if (!leftMissing && !rightMissing && left !== right) {
      const order =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) < Number(right)
            ? -1
            : Number(left) > Number(right)
              ? 1
              : 0;

      if (order !== 0) {
        return order * sign;
      }
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

function mergeSorted<Row>(
  left: Row[],
  right: Row[],
  compare: (a: Row, b: Row) => number,
) {
  const merged: Row[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    merged.push(compare(left[i]!, right[j]!) <= 0 ? left[i++]! : right[j++]!);
  }

  return merged.concat(left.slice(i), right.slice(j));
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
