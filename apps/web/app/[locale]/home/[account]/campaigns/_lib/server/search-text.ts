/**
 * Rôle : normalisation du texte tapé dans les recherches de villes et d'activités (fonctions pures).
 * Données : aucune ; mêmes règles que les colonnes ascii_name / search_key en base.
 * Écritures : aucune.
 */

/** Échappe les jokers de LIKE (% et _) saisis par l'utilisateur. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function stripAccents(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Texte de recherche d'activité : minuscules, sans accents, œ/æ développés,
 * apostrophes (’ ou ') et tirets remplacés par des espaces. Même règle que la
 * colonne lm_categories.search_key (27-leadmaker-discovery.sql).
 */
export function foldSearch(value: string) {
  return stripAccents(value.toLowerCase())
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/[’‘`´'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
