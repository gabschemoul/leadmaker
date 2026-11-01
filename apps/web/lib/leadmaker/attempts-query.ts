import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { ATTEMPT_GROUPS, type AttemptGroup } from './attempts';

type Client = SupabaseClient<Database>;

export const ATTEMPTS_PAGE_LIMIT = 500;
const SIGNED_URL_SECONDS = 60 * 60;

const COLUMNS =
  'id, status, template_name, template_used, subject, body, form_url, filled, missing, extra, protection_type, screenshot_before, screenshot_after, detail, sent_at, updated_at, created_at, prospect:lm_prospects!inner(id, name, website, city, category, found_email)';

/**
 * Formulaires d'un groupe de statuts (d'un dossier, ou d'une campagne), les
 * plus récents d'abord, avec un lien signé (1 h) vers la capture d'écran.
 * Utilisable côté serveur (premier rendu) comme côté navigateur (changement
 * d'onglet sans recharger la page) : la RLS filtre dans les deux cas.
 */
export async function fetchAttempts(
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

export type AttemptRow = Awaited<ReturnType<typeof fetchAttempts>>[number];
