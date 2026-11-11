import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

/**
 * Rôle : lecture de tout le catalogue d'activités (hors activités exclues), partagée par le parcours des familles,
 * « Tout sélectionner » et les propositions de l'IA.
 * Données : lm_categories, par pages de CATALOG_PAGE (une seule requête s'arrêtait aux 1 000 premières des ~3 900).
 * Écritures : aucune.
 */

/** Lignes par requête : l'API de la base n'en renvoie pas plus (max_rows). */
const CATALOG_PAGE = 1000;

export type CatalogRow = {
  gcid: string;
  label_fr: string;
  label_en: string;
  family: string;
};

export async function loadCatalog(client: SupabaseClient<Database>) {
  const rows: CatalogRow[] = [];

  // 20 pages au plus : garde-fou si le catalogue grossissait démesurément
  for (let page = 0; page < 20; page++) {
    const { data, error } = await client
      .from('lm_categories')
      .select('gcid, label_fr, label_en, family')
      .eq('is_excluded', false)
      .order('gcid', { ascending: true })
      .range(page * CATALOG_PAGE, (page + 1) * CATALOG_PAGE - 1);

    if (error) {
      return { data: null, error };
    }

    rows.push(...data);

    if (data.length < CATALOG_PAGE) {
      break;
    }
  }

  return { data: rows, error: null };
}
