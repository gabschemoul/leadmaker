import 'server-only';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { MAX_CATEGORIES_UNLIMITED } from '../schema/campaign.schema';

/**
 * Utilisateur « sans limite » : Gabriel et Nath (demandes du 3/11/2026). Même
 * liste que la recherche sur l'ordinateur dédié (lm_local_discovery_users,
 * 34-leadmaker-local-discovery.sql). Pour eux :
 * - les messages n'ont pas à mentionner la société de l'expéditeur.
 *
 * La table n'est lisible que par le service : on n'y lit que la ligne de
 * l'utilisateur connecté. En cas d'erreur, les règles normales s'appliquent.
 */
export async function isPowerUser(userId: string) {
  const { data, error } = await getSupabaseServerAdminClient()
    .from('lm_local_discovery_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  return !error && Boolean(data);
}

/**
 * Nombre d'activités qu'un utilisateur peut mettre dans une campagne : plus de limite pour personne (décision de
 * Gabriel, 11/11/2026 ; avant, 1 000 sauf pour Gabriel et Nath). MAX_CATEGORIES_UNLIMITED dépasse le catalogue.
 */
export async function getCategoryLimit(_userId: string) {
  return MAX_CATEGORIES_UNLIMITED;
}
