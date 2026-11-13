import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;
type Status = Database['public']['Enums']['lm_attempt_status'];

const PREPARING: Status[] = ['pending', 'preparing'];
const SENDING: Status[] = ['validated', 'sending'];

export interface WorkProgress {
  /** formulaires de la vague en préparation : déjà traités, au total (null : aucune préparation en cours) */
  prepare: { done: number; total: number } | null;
  /** envois validés de la vague : déjà partis (ou échoués), au total (null : aucun envoi en cours) */
  send: { done: number; total: number } | null;
}

/**
 * Avancement d'une préparation ou d'un envoi lancé hors pilote automatique (13/11/2026, demande de Gabriel : rien
 * ne montrait l'avancement d'une préparation lancée à la main). La « vague » = les tentatives hors pilote de la
 * campagne créées (préparation) ou validées (envoi) depuis la plus ancienne encore en cours. Lecture par la RLS.
 */
export async function fetchWorkProgress(
  client: Client,
  campaignId: string,
): Promise<WorkProgress> {
  const [prepare, send] = await Promise.all([
    wave(client, campaignId, PREPARING, 'created_at'),
    wave(client, campaignId, SENDING, 'validated_at'),
  ]);

  return { prepare, send };
}

async function wave(
  client: Client,
  campaignId: string,
  running: Status[],
  since: 'created_at' | 'validated_at',
) {
  const base = () =>
    client
      .from('lm_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .is('autopilot_id', null);

  const { data: oldest, error } = await client
    .from('lm_attempts')
    .select('created_at, validated_at')
    .eq('campaign_id', campaignId)
    .is('autopilot_id', null)
    .in('status', running)
    .order(since, { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const start = oldest?.[since];

  if (!start) {
    return null;
  }

  const [left, total] = await Promise.all([
    base().in('status', running),
    base().gte(since, start),
  ]);

  if (left.error) {
    throw left.error;
  }

  if (total.error) {
    throw total.error;
  }

  const all = Math.max(total.count ?? 0, left.count ?? 0);

  return { done: all - (left.count ?? 0), total: all };
}
