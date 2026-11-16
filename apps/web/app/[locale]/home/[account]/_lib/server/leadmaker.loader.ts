import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getLocale } from 'next-intl/server';

import type { Database } from '@kit/supabase/database';

import { toCountryOptions } from '~/lib/leadmaker/countries';

type Client = SupabaseClient<Database>;

/**
 * Identifiants des espaces de l'organisation, l'espace par défaut en premier. Les dossiers clients ne sont plus
 * affichés nulle part (décision du 16/11/2026) : les pages montrent toute l'organisation, tous espaces réunis.
 * Il y en a toujours au moins un.
 */
export async function loadSpaceIds(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_spaces')
    .select('id')
    .eq('account_id', accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  const ids = (data ?? []).map((space) => space.id);

  if (ids.length === 0) {
    throw new Error('lm_spaces: aucun espace pour cette organisation');
  }

  return ids;
}

/** Espace par défaut de l'organisation : là où se créent campagnes, imports et expéditeurs. */
export async function loadDefaultSpaceId(client: Client, accountId: string) {
  const [first] = await loadSpaceIds(client, accountId);

  return first!;
}

/** Pays couverts, nommés dans la langue de l'interface. */
export async function loadCountryOptions(client: Client) {
  const [{ data, error }, locale] = await Promise.all([
    client.from('lm_country_coverage').select('country_code, name'),
    getLocale(),
  ]);

  if (error) {
    throw error;
  }

  return toCountryOptions(data ?? [], locale);
}

/**
 * Crédits disponibles de l'organisation : solde du forfait + packs de crédits non expirés (10/11/2026,
 * lm_available_credits) ; 0 sans forfait ni pack.
 */
export async function loadAvailableCredits(client: Client, accountId: string) {
  const { data, error } = await client.rpc('lm_available_credits', {
    p_account_id: accountId,
  });

  if (error) {
    throw error;
  }

  return data ?? 0;
}

/**
 * L'organisation a-t-elle un forfait (ou un reste de crédits du forfait) ? Même règle que le bandeau
 * « Choisissez un forfait » et que lm_has_plan : les packs ne comptent pas, ils sont réservés aux abonnés et
 * les robots ne travaillent pas sans forfait.
 */
export async function loadHasPlan(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_account_credits')
    .select('plan_id, discovery_balance')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data?.plan_id) || (data?.discovery_balance ?? 0) > 0;
}
