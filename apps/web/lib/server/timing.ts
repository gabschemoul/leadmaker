/**
 * Chronomètre temporaire (10/11/2026) : écrit la durée d'une étape dans les journaux Vercel, seulement sur la
 * pré-prod (VERCEL_ENV=preview). Sert à trouver où part le temps de chargement des pages. À retirer ensuite.
 */
export async function timed<T>(label: string, work: Promise<T>): Promise<T> {
  if (process.env.VERCEL_ENV !== 'preview') {
    return work;
  }

  const start = performance.now();

  try {
    return await work;
  } finally {
    console.log(`[timing] ${label} ${Math.round(performance.now() - start)}ms`);
  }
}
