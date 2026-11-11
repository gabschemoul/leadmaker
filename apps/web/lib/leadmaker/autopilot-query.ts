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

/**
 * Section « En direct » du pilote (refaite le 11/11/2026) : les 3 derniers messages envoyés (cartes), l'issue de
 * chaque site visité (bilan par raison) et les heures d'envoi (rythme et prévision). Activité des prospects dans
 * la langue de l'appli quand l'annuaire la connaît.
 */
export async function fetchAutopilotLive(
  client: Client,
  autopilotId: string,
  locale: string,
) {
  // une requête de comptage par issue (l'API renvoie 1 000 lignes au plus : on ne lit jamais toutes les tentatives)
  const base = () =>
    client
      .from('lm_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('autopilot_id', autopilotId);

  const [recent, times, ...counts] = await Promise.all([
    client
      .from('lm_attempts')
      .select(
        'id, status, subject, body, template_name, form_url, sent_at, updated_at, screenshot_after, prospect:lm_prospects!inner(id, name, website, city, category)',
      )
      .eq('autopilot_id', autopilotId)
      .in('status', ['sent', 'to_verify'])
      .order('sent_at', { ascending: false, nullsFirst: false })
      .limit(3),
    // heures des derniers envois (rythme et prévision)
    client
      .from('lm_attempts')
      .select('sent_at')
      .eq('autopilot_id', autopilotId)
      .in('status', ['sent', 'to_verify'])
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1000),
    base().in('status', ['sent', 'to_verify']),
    base().eq('status', 'no_form').ilike('detail', '%devis%'),
    base().eq('status', 'no_form').not('detail', 'ilike', '%devis%'),
    base().eq('status', 'no_form').is('detail', null),
    base().in('status', ['unreachable', 'failed']),
    base().eq('status', 'intervention_required'),
    base().eq('status', 'incomplete'),
    base().eq('status', 'ready'),
    base().in('status', ['skipped', 'excluded']),
  ]);

  if (recent.error) throw recent.error;
  if (times.error) throw times.error;

  const [
    sent,
    quote,
    noFormText,
    noFormEmpty,
    unreachable,
    captcha,
    unknownField,
    toCheck,
    other,
  ] = counts.map((result) => result.count ?? 0);

  // libellé de l'activité dans la langue de l'appli (la fiche garde celui de l'annuaire, en anglais)
  const english = [
    ...new Set(
      (recent.data ?? [])
        .map((row) => row.prospect.category)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const labels = new Map<string, string>();

  if (english.length > 0 && !locale.startsWith('en')) {
    const { data } = await client
      .from('lm_categories')
      .select('label_en, label_fr')
      .in('label_en', english);

    for (const row of data ?? []) {
      labels.set(row.label_en, row.label_fr);
    }
  }

  return {
    sent: (recent.data ?? []).map((row) => ({
      ...row,
      activity: row.prospect.category
        ? (labels.get(row.prospect.category) ?? row.prospect.category)
        : null,
    })),
    /** nombre de sites par issue (bilan « Sur N sites visités ») */
    outcomes: {
      sent: sent!,
      quoteOnly: quote!,
      noForm: noFormText! + noFormEmpty!,
      unreachable: unreachable!,
      captcha: captcha!,
      unknownField: unknownField!,
      toCheck: toCheck!,
      other: other!,
    },
    sentTimes: (times.data ?? [])
      .map((row) => new Date(row.sent_at!).getTime())
      .reverse(),
  };
}

export type AutopilotLiveData = Awaited<ReturnType<typeof fetchAutopilotLive>>;
export type AutopilotSentCard = AutopilotLiveData['sent'][number];

/** Lien signé (1 h) vers la capture de l'envoi, null si aucune. */
export async function fetchAttemptScreenshot(
  client: Client,
  path: string | null,
) {
  if (!path) {
    return null;
  }

  const { data } = await client.storage
    .from('lm_screenshots')
    .createSignedUrl(path, SIGNED_URL_SECONDS);

  return data?.signedUrl ?? null;
}
