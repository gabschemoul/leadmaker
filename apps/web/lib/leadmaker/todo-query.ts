import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

/** Les trois listes « À vous de jouer » de l'étape Envoi (lm_attempt_todo_kind). */
export const TODO_KINDS = ['to_check', 'captcha', 'unknown_field'] as const;

export type TodoKind = (typeof TODO_KINDS)[number];

const SIGNED_URL_SECONDS = 60 * 60;

/** Nombre de formulaires qui attendent une décision dans une campagne, par liste. */
export async function fetchCampaignTodo(client: Client, campaignId: string) {
  const { data, error } = await client
    .rpc('lm_campaign_todo', { p_campaign_id: campaignId })
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    to_check: data?.to_check ?? 0,
    captcha: data?.captcha ?? 0,
    unknown_field: data?.unknown_field ?? 0,
  } satisfies Record<TodoKind, number>;
}

export type CampaignTodo = Awaited<ReturnType<typeof fetchCampaignTodo>>;

/** Identifiants des formulaires d'une liste, les plus anciens d'abord (500 au plus). */
export async function fetchTodoIds(
  client: Client,
  campaignId: string,
  kind: TodoKind,
) {
  const { data, error } = await client.rpc('lm_campaign_todo_ids', {
    p_campaign_id: campaignId,
    p_kind: kind,
  });

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Un formulaire à traiter : prospect, page du formulaire, message, raison du doute, cases manquantes et capture
 * du formulaire rempli (lien signé 1 h). Activité dans la langue de l'appli quand l'annuaire la connaît.
 * Lecture filtrée par la RLS.
 */
export async function fetchTodoItem(
  client: Client,
  attemptId: string,
  locale: string,
) {
  const { data, error } = await client
    .from('lm_attempts')
    .select(
      'id, status, subject, body, form_url, detail, missing, extra, protection_type, screenshot_before, prospect:lm_prospects!inner(id, name, website, city, category)',
    )
    .eq('id', attemptId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const [screenshot, label] = await Promise.all([
    data.screenshot_before
      ? client.storage
          .from('lm_screenshots')
          .createSignedUrl(data.screenshot_before, SIGNED_URL_SECONDS)
      : Promise.resolve(null),
    data.prospect.category && !locale.startsWith('en')
      ? client
          .from('lm_categories')
          .select('label_fr')
          .eq('label_en', data.prospect.category)
          .limit(1)
          .maybeSingle()
      : Promise.resolve(null),
  ]);

  return {
    ...data,
    activity: label?.data?.label_fr ?? data.prospect.category,
    screenshotUrl: screenshot?.data?.signedUrl ?? null,
  };
}

export type TodoItem = NonNullable<Awaited<ReturnType<typeof fetchTodoItem>>>;
