import 'server-only';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import {
  MAX_CATEGORIES,
  MAX_CATEGORIES_UNLIMITED,
} from '../schema/campaign.schema';

/**
 * Nombre d'activités qu'un utilisateur peut mettre dans une campagne.
 *
 * Gabriel et Nath n'ont pas la limite de 1 000 (demande du 3/11/2026) : même
 * liste d'utilisateurs que la recherche sur l'ordinateur dédié
 * (lm_local_discovery_users, 34-leadmaker-local-discovery.sql). La table n'est
 * lisible que par le service : on n'y lit que la ligne de l'utilisateur
 * connecté. En cas d'erreur, la limite normale s'applique.
 */
export async function getCategoryLimit(userId: string) {
  const { data, error } = await getSupabaseServerAdminClient()
    .from('lm_local_discovery_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  return !error && data ? MAX_CATEGORIES_UNLIMITED : MAX_CATEGORIES;
}
