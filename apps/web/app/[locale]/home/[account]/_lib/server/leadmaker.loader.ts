import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getLocale } from 'next-intl/server';

import type { Database } from '@kit/supabase/database';

import { toCountryOptions } from '~/lib/leadmaker/countries';

type Client = SupabaseClient<Database>;

/** Espaces de l'organisation, du plus ancien au plus récent. */
export async function loadSpaces(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_spaces')
    .select('id, name, country_code, language_code, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export type SpaceSummary = Awaited<ReturnType<typeof loadSpaces>>[number];

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

/** Solde de crédits découverte de l'organisation (0 sans forfait). */
export async function loadDiscoveryBalance(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_account_credits')
    .select('discovery_balance')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.discovery_balance ?? 0;
}
