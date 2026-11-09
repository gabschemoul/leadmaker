import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import {
  ATTEMPT_GROUPS,
  type AttemptGroup,
  type AttemptStatus,
  groupOfStatus,
} from '~/lib/leadmaker/attempts';
import { fetchAttempts } from '~/lib/leadmaker/attempts-query';

export {
  ATTEMPTS_PAGE_LIMIT,
  type AttemptRow,
} from '~/lib/leadmaker/attempts-query';

type Client = SupabaseClient<Database>;

function emptyCounts() {
  const counts = {} as Record<AttemptGroup, number>;

  for (const group of Object.keys(ATTEMPT_GROUPS) as AttemptGroup[]) {
    counts[group] = 0;
  }

  return counts;
}

/** Nombre de formulaires par groupe (onglets) d'un dossier. */
export async function loadAttemptCounts(client: Client, spaceId: string) {
  const { data, error } = await client.rpc('lm_attempt_counts', {
    p_space_id: spaceId,
  });

  if (error) {
    throw error;
  }

  const counts = emptyCounts();

  for (const row of data ?? []) {
    counts[groupOfStatus(row.status as AttemptStatus)] += Number(row.total);
  }

  return counts;
}

const COUNT_ROWS_LIMIT = 50_000;

/**
 * Nombre de formulaires par groupe pour UNE campagne (étape Contacter).
 * Une seule requête : les statuts seuls, comptés ici.
 */
export async function loadCampaignAttemptCounts(
  client: Client,
  campaignId: string,
) {
  const { data, error } = await client
    .from('lm_attempts')
    .select('status')
    .eq('campaign_id', campaignId)
    .limit(COUNT_ROWS_LIMIT);

  if (error) {
    throw error;
  }

  const counts = emptyCounts();

  for (const row of data ?? []) {
    counts[groupOfStatus(row.status)] += 1;
  }

  return counts;
}

/** Formulaires d'un groupe (premier rendu côté serveur). */
export function loadAttempts(
  client: Client,
  params: { spaceId: string; group: AttemptGroup; campaignId?: string },
) {
  return fetchAttempts(client, params);
}
