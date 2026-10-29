import type { VisibilityState } from '@tanstack/react-table';

import type { ProspectSortKey } from '~/lib/leadmaker/prospects-query';

/**
 * Colonnes du tableau de prospects, dans l'ordre d'affichage. Les colonnes
 * triables portent l'identifiant de leur clé de tri dans l'URL.
 */
export const PROSPECT_COLUMN_IDS = [
  'name',
  'category',
  'city',
  'rating',
  'reviews',
  'address',
  'phone',
  'website',
  'email',
  'source',
  'campaign',
  'date',
] as const;

export type ProspectColumnId = (typeof PROSPECT_COLUMN_IDS)[number];

export const SORTABLE_PROSPECT_COLUMNS = new Set<ProspectColumnId>([
  'name',
  'rating',
  'reviews',
  'city',
  'category',
  'date',
]);

export function isProspectSortKey(id: string): id is ProspectSortKey {
  return SORTABLE_PROSPECT_COLUMNS.has(id as ProspectColumnId);
}

/** Colonnes masquées par défaut : adresse, e-mail, origine et campagne. */
export const DEFAULT_PROSPECT_COLUMN_VISIBILITY: VisibilityState = {
  address: false,
  email: false,
  source: false,
  campaign: false,
};

/** Clé de stockage navigateur des colonnes choisies, par organisation. */
export function prospectColumnsStorageKey(accountId: string) {
  return `leadmaker.prospects.columns.${accountId}`;
}
