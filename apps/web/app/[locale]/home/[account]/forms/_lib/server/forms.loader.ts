import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import {
  ATTEMPT_GROUPS,
  type AttemptGroup,
  type AttemptStatus,
  groupOfStatus,
} from '~/lib/leadmaker/attempts';

type Client = SupabaseClient<Database>;

export const ATTEMPTS_PAGE_LIMIT = 500;
const SIGNED_URL_SECONDS = 60 * 60;

/** Nombre de formulaires par groupe (onglets). */
export async function loadAttemptCounts(client: Client, spaceId: string) {
  const { data, error } = await client.rpc('lm_attempt_counts', {
    p_space_id: spaceId,
  });

  if (error) {
    throw error;
  }

  const counts = {} as Record<AttemptGroup, number>;

  for (const group of Object.keys(ATTEMPT_GROUPS) as AttemptGroup[]) {
    counts[group] = 0;
  }

  for (const row of data ?? []) {
    counts[groupOfStatus(row.status as AttemptStatus)] += Number(row.total);
  }

  return counts;
}

/**
 * Nombre de formulaires par groupe pour UNE campagne (onglet Contacter).
 * Un comptage par groupe, en parallèle : léger quelle que soit la taille de
 * la campagne.
 */
export async function loadCampaignAttemptCounts(
  client: Client,
  campaignId: string,
) {
  const groups = Object.keys(ATTEMPT_GROUPS) as AttemptGroup[];

  const results = await Promise.all(
    groups.map((group) =>
      client
        .from('lm_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .in('status', [...ATTEMPT_GROUPS[group]]),
    ),
  );

  const counts = {} as Record<AttemptGroup, number>;

  groups.forEach((group, index) => {
    const result = results[index]!;

    if (result.error) {
      throw result.error;
    }

    counts[group] = result.count ?? 0;
  });

  return counts;
}

const COLUMNS =
  'id, status, template_name, template_used, subject, body, form_url, filled, missing, extra, protection_type, screenshot_before, screenshot_after, detail, sent_at, updated_at, created_at, prospect:lm_prospects!inner(id, name, website, city, category, found_email)';

/**
 * Formulaires d'un groupe de statuts, les plus récents d'abord, avec un lien
 * signé (1 h) vers la capture d'écran.
 */
export async function loadAttempts(
  client: Client,
  params: { spaceId: string; group: AttemptGroup; campaignId?: string },
) {
  let query = client
    .from('lm_attempts')
    .select(COLUMNS)
    .eq('space_id', params.spaceId)
    .in('status', [...ATTEMPT_GROUPS[params.group]]);

  if (params.campaignId) {
    query = query.eq('campaign_id', params.campaignId);
  }

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(ATTEMPTS_PAGE_LIMIT);

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const paths = rows
    .flatMap((row) => [row.screenshot_before, row.screenshot_after])
    .filter((path): path is string => Boolean(path));

  const urls = new Map<string, string>();

  if (paths.length > 0) {
    const signed = await client.storage
      .from('lm_screenshots')
      .createSignedUrls(paths, SIGNED_URL_SECONDS);

    for (const item of signed.data ?? []) {
      if (item.path && item.signedUrl) {
        urls.set(item.path, item.signedUrl);
      }
    }
  }

  return rows.map((row) => ({
    ...row,
    screenshotUrl: row.screenshot_before
      ? (urls.get(row.screenshot_before) ?? null)
      : null,
    screenshotAfterUrl: row.screenshot_after
      ? (urls.get(row.screenshot_after) ?? null)
      : null,
  }));
}

export type AttemptRow = Awaited<ReturnType<typeof loadAttempts>>[number];

/** Solde de crédits d'envoi de l'organisation (0 sans forfait). */
export async function loadOutreachBalance(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_account_credits')
    .select('outreach_balance')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.outreach_balance ?? 0;
}
