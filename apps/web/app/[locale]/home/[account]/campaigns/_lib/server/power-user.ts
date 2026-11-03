import 'server-only';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import {
  MAX_CATEGORIES,
  MAX_CATEGORIES_UNLIMITED,
} from '../schema/campaign.schema';

/**
 * Utilisateur « sans limite » : Gabriel et Nath (demandes du 3/11/2026). Même
 * liste que la recherche sur l'ordinateur dédié (lm_local_discovery_users,
 * 34-leadmaker-local-discovery.sql). Pour eux :
 * - plus de limite de 1 000 activités par campagne (getCategoryLimit) ;
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

/** Nombre d'activités qu'un utilisateur peut mettre dans une campagne. */
export async function getCategoryLimit(userId: string) {
  return (await isPowerUser(userId))
    ? MAX_CATEGORIES_UNLIMITED
    : MAX_CATEGORIES;
}
