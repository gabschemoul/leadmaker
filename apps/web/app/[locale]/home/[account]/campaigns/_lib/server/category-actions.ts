'use server';

/**
 * Rôle : actions serveur du catalogue d'activités (familles, recherche, « Tout sélectionner »).
 * Données : lecture de lm_categories (client Supabase de l'utilisateur, RLS) ; limite par utilisateur (power-user.ts).
 * Écritures : aucune.
 */
import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  FamilyCategoriesSchema,
  SearchCategoriesSchema,
} from '../schema/campaign.schema';
import { loadCatalog } from './catalog';
import { getCategoryLimit } from './power-user';
import { foldSearch } from './search-text';

/**
 * Familles d'activités (catalogue Google, 25 familles) avec leur nombre
 * d'activités, pour parcourir les activités sans connaître leur nom exact.
 */
export const listCategoryFamiliesAction = authActionClient.action(async () => {
  const { data, error } = await loadCatalog(getSupabaseServerClient());

  if (error) {
    const logger = await getLogger();
    logger.error(
      { name: 'leadmaker.categories.families', error },
      'Category families failed',
    );

    throw new Error('campaigns.errors.searchFailed');
  }

  const counts = new Map<string, number>();

  for (const row of data ?? []) {
    counts.set(row.family, (counts.get(row.family) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => a.family.localeCompare(b.family, 'fr'));
});

/**
 * Toutes les activités du catalogue, pour « Tout sélectionner » (utilisateurs
 * sans limite d'activités seulement : sinon la sélection dépasserait la limite).
 */
export const listAllCategoriesAction = authActionClient.action(
  async ({ ctx }) => {
    const [limit, catalog] = await Promise.all([
      getCategoryLimit(ctx.user.id),
      loadCatalog(getSupabaseServerClient()),
    ]);

    if (catalog.error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.categories.all', error: catalog.error },
        'All categories failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    if (catalog.data.length > limit) {
      throw new Error('campaigns.errors.tooManyCategories');
    }

    return catalog.data.map((category) => ({
      gcid: category.gcid,
      labelFr: category.label_fr,
      labelEn: category.label_en,
      family: category.family,
    }));
  },
);

/** Les activités d'une famille : les plus courantes d'abord, puis par ordre alphabétique. */
export const listFamilyCategoriesAction = authActionClient
  .inputSchema(FamilyCategoriesSchema)
  .action(async ({ parsedInput: { family } }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('lm_categories')
      .select('gcid, label_fr, label_en, family, is_generic')
      .eq('is_excluded', false)
      .eq('family', family)
      .order('is_generic', { ascending: false })
      .order('label_fr', { ascending: true })
      .limit(1000);

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.categories.family', error },
        'Family categories failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    return (data ?? []).map((category) => ({
      gcid: category.gcid,
      labelFr: category.label_fr,
      labelEn: category.label_en,
      family: category.family,
      common: category.is_generic,
    }));
  });

/** Autocomplétion des catégories Google (libellé français ou anglais). */
export const searchCategoriesAction = authActionClient
  .inputSchema(SearchCategoriesSchema)
  .action(async ({ parsedInput: { query } }) => {
    const client = getSupabaseServerClient();

    // Mots tapés, sans accents ni apostrophes ni tirets (comme search_key en
    // base), et sans jokers LIKE ni caractères de syntaxe PostgREST. Chaque
    // mot doit apparaître, dans n'importe quel ordre.
    const words = foldSearch(query)
      .replace(/[,()"*:\\%_.]/g, ' ')
      .split(' ')
      .filter(Boolean)
      .slice(0, 6);

    if (words.length === 0) {
      return [];
    }

    let request = client
      .from('lm_categories')
      .select('gcid, label_fr, label_en, family')
      .eq('is_excluded', false);

    for (const word of words) {
      request = request.ilike('search_key', `%${word}%`);
    }

    const { data, error } = await request
      .order('is_generic', { ascending: false })
      .order('label_fr', { ascending: true })
      .limit(30);

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.categories.search', error },
        'Category search failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    return (data ?? []).map((category) => ({
      gcid: category.gcid,
      labelFr: category.label_fr,
      labelEn: category.label_en,
      family: category.family,
    }));
  });
