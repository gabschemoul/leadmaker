import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

export type AutopilotStatus =
  Database['public']['Enums']['lm_autopilot_status'];

const SIGNED_URL_SECONDS = 60 * 60;

/** Remarque tolérée sur un formulaire « sans doute » (même règle que lm_attempt_is_clean en SQL). */
const SHORT_VERSION_NOTE = 'version courte utilisée (zone de message limitée)';

/**
 * Tout ce que l'écran du pilote automatique affiche, en une ligne (lm_autopilot_summary) :
 * dernier passage de la campagne, compteurs, prospects restants, crédits. Null si la campagne
 * n'est pas visible (RLS).
 */
export async function fetchAutopilotSummary(
  client: Client,
  campaignId: string,
) {
  const { data, error } = await client.rpc('lm_autopilot_summary', {
    p_campaign_id: campaignId,
  });

  if (error) {
    throw error;
  }

  return data?.[0] ?? null;
}

/**
 * Les trois chiffres du pilote dont la barre des étapes a besoin (statut, envoyés, objectif) : deux petites
 * requêtes au lieu du résumé complet (lm_autopilot_summary, ~1 s sur une grosse campagne), réservé à
 * l'étape Envoi (10/11/2026).
 */
export async function fetchAutopilotFacts(client: Client, campaignId: string) {
  const { data: pilot, error } = await client
    .from('lm_autopilots')
    .select('id, status, target')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!pilot) {
    return null;
  }

  const { count, error: countError } = await client
    .from('lm_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('autopilot_id', pilot.id)
    .in('status', ['sending', 'sent']);

  if (countError) {
    throw countError;
  }

  return { status: pilot.status, sent: count ?? 0, target: pilot.target };
}

export type AutopilotSummary = NonNullable<
  Awaited<ReturnType<typeof fetchAutopilotSummary>>
>;

/** Un passage est « actif » tant qu'il n'est ni terminé ni annulé. */
export function isAutopilotActive(status: AutopilotStatus | null | undefined) {
  return status === 'preview' || status === 'running' || status === 'paused';
}

/** Dernières tentatives du passage, pour le fil « En direct » (vrais événements uniquement). */
export async function fetchAutopilotFeed(client: Client, autopilotId: string) {
  const { data, error } = await client
    .from('lm_attempts')
    .select(
      'id, status, detail, protection_type, missing, form_url, updated_at, prospect:lm_prospects!inner(name, website)',
    )
    .eq('autopilot_id', autopilotId)
    .order('updated_at', { ascending: false })
    .limit(9);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export type AutopilotFeedRow = Awaited<
  ReturnType<typeof fetchAutopilotFeed>
>[number];

export function isCleanAttempt(row: {
  status: string;
  detail: string | null;
  protection_type: string | null;
  missing: unknown;
}) {
  return (
    row.status === 'ready' &&
    row.protection_type === null &&
    (!Array.isArray(row.missing) || row.missing.length === 0) &&
    (row.detail === null || row.detail === SHORT_VERSION_NOTE)
  );
}

/** Formulaires prêts de l'aperçu (les 3 premiers sans doute), avec un lien signé vers leur capture. */
export async function fetchAutopilotPreview(
  client: Client,
  autopilotId: string,
) {
  const { data, error } = await client
    .from('lm_attempts')
    .select(
      'id, status, detail, protection_type, missing, form_url, subject, body, screenshot_before, created_at, prospect:lm_prospects!inner(name, website)',
    )
    .eq('autopilot_id', autopilotId)
    .eq('status', 'ready')
    .order('created_at', { ascending: true })
    .limit(30);

  if (error) {
    throw error;
  }

  const rows = (data ?? []).filter(isCleanAttempt).slice(0, 3);
  const paths = rows
    .map((row) => row.screenshot_before)
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
  }));
}

export type AutopilotPreviewRow = Awaited<
  ReturnType<typeof fetchAutopilotPreview>
>[number];

/** Nom de domaine lisible d'une adresse (sans « www. »). */
export function displayHost(url: string | null | undefined) {
  if (!url) return '';

  try {
    const parsed = new URL(url.includes('://') ? url : `http://${url}`);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;

    return `${parsed.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}
