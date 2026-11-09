import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { ATTEMPT_GROUPS, type AttemptStatus } from '~/lib/leadmaker/attempts';
import type { CampaignTemplates } from '~/lib/leadmaker/templates';

type Client = SupabaseClient<Database>;

/** Statuts comptés comme « Envoyés » (même groupe que l'onglet Envoyés des formulaires). */
const SENT_STATUSES: AttemptStatus[] = [...ATTEMPT_GROUPS.sent];
/** Statuts « À vérifier » : envoyé sans confirmation claire vue sur le site. */
const TO_VERIFY_STATUSES: AttemptStatus[] = [...ATTEMPT_GROUPS.to_verify];

function attemptsCount(
  client: Client,
  campaignId: string,
  statuses: AttemptStatus[],
  templateName?: string,
) {
  let query = client
    .from('lm_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', statuses);

  if (templateName !== undefined) {
    query = query.eq('template_name', templateName);
  }

  return query.then(({ count, error }) => {
    if (error) throw error;

    return count ?? 0;
  });
}

/**
 * Campagne sans cible en mots : les entreprises qu'elle peut contacter, avec les mêmes règles que
 * `lm_prepare_campaign` (site web connu, pas écartée, pas une fiche sans site).
 */
async function contactableCount(client: Client, campaignId: string) {
  const { count, error } = await client
    .from('lm_campaign_prospects')
    .select('prospect_id, prospect:lm_prospects!inner(id)', {
      count: 'exact',
      head: true,
    })
    .eq('campaign_id', campaignId)
    .is('prospect.excluded_at', null)
    .not('prospect.website', 'is', null)
    .not('prospect.site_key', 'like', 'maps:%')
    .not('prospect.site_key', 'like', 'tel:%');

  if (error) throw error;

  return count ?? 0;
}

/**
 * Écran « Résultats » d'une campagne : prises de contact parties sur le total à contacter, et envois par
 * version du message (`lm_attempts.template_name`). Comptages exacts (`count`, sans lire les lignes), avec le
 * client Supabase de l'utilisateur : la RLS filtre.
 * Total : campagne triée → ses entreprises gardées (`kept`) ; sinon → ses entreprises avec un site.
 */
export async function loadCampaignResults(
  client: Client,
  params: {
    campaignId: string;
    templates: CampaignTemplates;
    /** entreprises gardées d'une campagne triée ; null pour une campagne sans cible en mots */
    kept: number | null;
  },
) {
  const names = [
    ...new Set(params.templates.messages.map((message) => message.name)),
  ];

  const [sent, toVerify, contactable, perName] = await Promise.all([
    attemptsCount(client, params.campaignId, SENT_STATUSES),
    attemptsCount(client, params.campaignId, TO_VERIFY_STATUSES),
    params.kept === null
      ? contactableCount(client, params.campaignId)
      : Promise.resolve(params.kept),
    Promise.all(
      names.map(async (name) => {
        const [nameSent, nameToVerify] = await Promise.all([
          attemptsCount(client, params.campaignId, SENT_STATUSES, name),
          attemptsCount(client, params.campaignId, TO_VERIFY_STATUSES, name),
        ]);

        return { name, sent: nameSent, toVerify: nameToVerify };
      }),
    ),
  ]);

  const versions = params.templates.messages.map((message, index) => {
    const counts = perName.find((row) => row.name === message.name);

    return {
      index,
      name: message.name,
      usable: message.body.trim() !== '',
      preview: message.body.replace(/\s+/g, ' ').trim().slice(0, 120),
      sent: counts?.sent ?? 0,
      toVerify: counts?.toVerify ?? 0,
    };
  });

  // envois faits avec une version supprimée ou renommée depuis (ou sans version enregistrée)
  const knownSent = perName.reduce((sum, row) => sum + row.sent, 0);
  const knownToVerify = perName.reduce((sum, row) => sum + row.toVerify, 0);

  return {
    sent,
    toVerify,
    // une entreprise contactée reste comptée même si elle a été retirée de la liste depuis
    total: Math.max(contactable, sent),
    versions: versions.filter(
      (version) => version.usable || version.sent + version.toVerify > 0,
    ),
    other: {
      sent: Math.max(0, sent - knownSent),
      toVerify: Math.max(0, toVerify - knownToVerify),
    },
  };
}

export type CampaignResults = Awaited<ReturnType<typeof loadCampaignResults>>;
