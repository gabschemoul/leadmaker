import * as z from 'zod';

/**
 * Paramètres de la liste de prospects : lus dans l'URL (page Prospects) et
 * dans la requête d'export CSV, appliqués à une requête PostgREST.
 *
 * Partagé entre le serveur et le client : pas de `server-only`.
 */

export const PROSPECTS_PAGE_SIZE = 50;

export const PROSPECT_SORT_KEYS = [
  'name',
  'rating',
  'reviews',
  'city',
  'category',
  'date',
] as const;

export type ProspectSortKey = (typeof PROSPECT_SORT_KEYS)[number];
export type ProspectSortDir = 'asc' | 'desc';

/** Colonne SQL de chaque clé de tri. */
export const PROSPECT_SORT_COLUMNS: Record<ProspectSortKey, string> = {
  name: 'name',
  rating: 'rating',
  reviews: 'review_count',
  city: 'city',
  category: 'category',
  date: 'created_at',
};

const WEBSITE_FILTERS = ['with', 'without'] as const;
const SOURCES = ['maps', 'csv'] as const;
const STATUSES = ['active', 'excluded', 'all'] as const;

export type ProspectWebsiteFilter = (typeof WEBSITE_FILTERS)[number];
export type ProspectSource = (typeof SOURCES)[number];
export type ProspectStatusFilter = (typeof STATUSES)[number];

const MAX_LIST_VALUES = 50;
const MAX_LIST_VALUE_LENGTH = 200;

const listValue = z.string().trim().min(1).max(MAX_LIST_VALUE_LENGTH);

const ProspectsFiltersSchema = z.object({
  query: z.string().trim().max(100).optional().catch(undefined),
  campaign: z.string().uuid().optional().catch(undefined),
  categories: z.array(listValue).max(MAX_LIST_VALUES).catch([]),
  cities: z.array(listValue).max(MAX_LIST_VALUES).catch([]),
  ratingMin: z.coerce.number().min(0).max(5).optional().catch(undefined),
  ratingMax: z.coerce.number().min(0).max(5).optional().catch(undefined),
  reviewsMin: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .optional()
    .catch(undefined),
  website: z.enum(WEBSITE_FILTERS).optional().catch(undefined),
  source: z.enum(SOURCES).optional().catch(undefined),
  status: z.enum(STATUSES).catch('active'),
});

export type ProspectsFilters = z.output<typeof ProspectsFiltersSchema>;

const ProspectsListParamsSchema = z.object({
  space: z.string().uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  sort: z.enum(PROSPECT_SORT_KEYS).catch('date'),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
});

export interface ProspectsListState {
  space: string | undefined;
  page: number;
  sort: ProspectSortKey;
  dir: ProspectSortDir;
  filters: ProspectsFilters;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined) {
  if (value === undefined) return [];

  return Array.isArray(value) ? value : [value];
}

/** Sens par défaut d'un tri : les meilleures notes et les plus récents d'abord. */
export function defaultSortDir(sort: ProspectSortKey): ProspectSortDir {
  return sort === 'rating' || sort === 'reviews' || sort === 'date'
    ? 'desc'
    : 'asc';
}

/**
 * Lit les paramètres d'URL de la liste. Une valeur invalide est ignorée
 * plutôt que de faire échouer la page (lien partagé périmé, saisie manuelle).
 */
export function parseProspectsSearchParams(
  raw: RawSearchParams,
): ProspectsListState {
  const params = ProspectsListParamsSchema.parse({
    space: first(raw.space),
    page: first(raw.page),
    sort: first(raw.sort),
    dir: first(raw.dir),
  });

  const filters = ProspectsFiltersSchema.parse({
    query: first(raw.q),
    campaign: first(raw.campaign),
    categories: all(raw.cat),
    cities: all(raw.city),
    ratingMin: first(raw.rmin),
    ratingMax: first(raw.rmax),
    reviewsMin: first(raw.reviews),
    website: first(raw.website),
    source: first(raw.source),
    status: first(raw.status),
  });

  return {
    space: params.space,
    page: params.page,
    sort: params.sort,
    dir: params.dir ?? defaultSortDir(params.sort),
    filters,
  };
}

/** État partiel accepté par les constructeurs d'URL : tout est facultatif. */
export type ProspectsHrefState = Partial<
  Omit<ProspectsListState, 'filters'>
> & {
  filters?: Partial<ProspectsFilters>;
};

/** Paramètres d'URL de la liste, sans ceux qui valent leur défaut. */
export function toProspectsSearchParams(state: ProspectsHrefState) {
  const params = new URLSearchParams();
  const filters: Partial<ProspectsFilters> = state.filters ?? {};

  if (state.space) params.set('space', state.space);
  if (filters.query) params.set('q', filters.query);
  if (filters.campaign) params.set('campaign', filters.campaign);

  for (const category of filters.categories ?? []) {
    params.append('cat', category);
  }

  for (const city of filters.cities ?? []) {
    params.append('city', city);
  }

  if (filters.ratingMin !== undefined) {
    params.set('rmin', String(filters.ratingMin));
  }

  if (filters.ratingMax !== undefined) {
    params.set('rmax', String(filters.ratingMax));
  }

  if (filters.reviewsMin !== undefined) {
    params.set('reviews', String(filters.reviewsMin));
  }

  if (filters.website) params.set('website', filters.website);
  if (filters.source) params.set('source', filters.source);

  if (filters.status && filters.status !== 'active') {
    params.set('status', filters.status);
  }

  if (state.sort && state.sort !== 'date') {
    params.set('sort', state.sort);
  }

  if (state.sort && state.dir && state.dir !== defaultSortDir(state.sort)) {
    params.set('dir', state.dir);
  }

  if (state.page && state.page > 1) params.set('page', String(state.page));

  return params;
}

export function buildProspectsHref(
  basePath: string,
  state: ProspectsHrefState,
) {
  const query = toProspectsSearchParams(state).toString();

  return query ? `${basePath}?${query}` : basePath;
}

/** Nombre de filtres posés (hors statut « actifs », qui est le défaut). */
export function countActiveFilters(filters: ProspectsFilters) {
  return (
    (filters.query ? 1 : 0) +
    (filters.campaign ? 1 : 0) +
    filters.categories.length +
    filters.cities.length +
    (filters.ratingMin !== undefined ? 1 : 0) +
    (filters.ratingMax !== undefined ? 1 : 0) +
    (filters.reviewsMin !== undefined ? 1 : 0) +
    (filters.website ? 1 : 0) +
    (filters.source ? 1 : 0) +
    (filters.status !== 'active' ? 1 : 0)
  );
}

export const EMPTY_PROSPECTS_FILTERS: ProspectsFilters = {
  query: undefined,
  campaign: undefined,
  categories: [],
  cities: [],
  ratingMin: undefined,
  ratingMax: undefined,
  reviewsMin: undefined,
  website: undefined,
  source: undefined,
  status: 'active',
};

/**
 * Sous-ensemble du constructeur de requête PostgREST utilisé ici. Les méthodes
 * renvoient `this`, ce qui permet d'accepter le constructeur typé de
 * supabase-js sans en répéter les génériques.
 */
export interface ProspectsFilterBuilder {
  eq(column: string, value: string): this;
  neq(column: string, value: string): this;
  in(column: string, values: readonly string[]): this;
  gte(column: string, value: number): this;
  lte(column: string, value: number): this;
  is(column: string, value: null): this;
  not(column: string, operator: 'is', value: null): this;
  or(filters: string): this;
}

/**
 * Nettoie un terme de recherche pour un filtre `or` PostgREST : les
 * caractères de sa syntaxe (virgule, parenthèses, guillemets, deux-points,
 * étoile) et les jokers LIKE sont remplacés par des espaces, l'échappement
 * n'étant pas fiable à l'intérieur d'un `or`.
 */
export function sanitizeSearchTerm(query: string) {
  return query
    .replace(/[,()"*:\\%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Applique les filtres de la liste à une requête sur `lm_prospects`. */
export function applyProspectsFilters<Builder extends ProspectsFilterBuilder>(
  request: Builder,
  filters: ProspectsFilters,
): Builder {
  let query = request;

  if (filters.query) {
    const term = sanitizeSearchTerm(filters.query);

    if (term) {
      const pattern = `%${term}%`;

      query = query.or(
        [
          `name.ilike.${pattern}`,
          `address.ilike.${pattern}`,
          `site_key.ilike.${pattern}`,
          `phone.ilike.${pattern}`,
        ].join(','),
      );
    }
  }

  if (filters.campaign) {
    query = query.eq('campaign_id', filters.campaign);
  }

  if (filters.categories.length > 0) {
    query = query.in('category', filters.categories);
  }

  if (filters.cities.length > 0) {
    query = query.in('city', filters.cities);
  }

  if (filters.ratingMin !== undefined) {
    query = query.gte('rating', filters.ratingMin);
  }

  if (filters.ratingMax !== undefined) {
    query = query.lte('rating', filters.ratingMax);
  }

  if (filters.reviewsMin !== undefined) {
    query = query.gte('review_count', filters.reviewsMin);
  }

  if (filters.website === 'with') {
    query = query.not('website', 'is', null).neq('website', '');
  } else if (filters.website === 'without') {
    query = query.or('website.is.null,website.eq.""');
  }

  if (filters.source) {
    query = query.eq('source', filters.source);
  }

  if (filters.status === 'active') {
    query = query.is('excluded_at', null);
  } else if (filters.status === 'excluded') {
    query = query.not('excluded_at', 'is', null);
  }

  return query;
}
