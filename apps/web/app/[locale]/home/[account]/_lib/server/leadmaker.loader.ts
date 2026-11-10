import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getLocale, getTranslations } from 'next-intl/server';

import type { Database } from '@kit/supabase/database';

import { toCountryOptions } from '~/lib/leadmaker/countries';
import { spaceLabel } from '~/lib/leadmaker/space-label';

type Client = SupabaseClient<Database>;

/**
 * Renvoie une fonction qui donne le libellé affiché d'un dossier client :
 * « Mon entreprise » pour l'espace par défaut, son nom sinon.
 */
export async function getSpaceLabeler() {
  const t = await getTranslations('campaigns');
  const defaultLabel = t('folders.defaultName');

  return (space: { name: string; is_default: boolean }) =>
    spaceLabel(space, defaultLabel);
}

/**
 * Dossiers clients (espaces) de l'organisation : l'espace par défaut en
 * premier, puis du plus ancien au plus récent. Il y en a toujours au moins un.
 */
/** L'organisation a-t-elle plusieurs dossiers clients ? (menu « Dossiers clients ») */
export async function hasSeveralSpaces(client: Client, accountId: string) {
  const { count, error } = await client
    .from('lm_spaces')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 1;
}

export async function loadSpaces(client: Client, accountId: string) {
  const [{ data, error }, label] = await Promise.all([
    client
      .from('lm_spaces')
      .select('id, name, is_default, created_at')
      .eq('account_id', accountId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
    getSpaceLabeler(),
  ]);

  if (error) {
    throw error;
  }

  return (data ?? []).map((space) => ({ ...space, label: label(space) }));
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
