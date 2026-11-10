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
 * « Un message par groupe » : par groupe, entreprises gardées (et payées), envois partis et à vérifier
 * (lm_campaign_group_results), dans l'ordre des groupes ; « Hors groupes » (clé null) en dernier. En cas d'erreur
 * (fonction absente en base…), pas de carte plutôt qu'une page cassée.
 */
async function groupResults(
  client: Client,
  campaignId: string,
  groups: Array<{ key: string; label: string }>,
) {
  const { data, error } = await client.rpc('lm_campaign_group_results', {
    p_campaign_id: campaignId,
  });

  if (error) return null;

  const rows = (data ?? []).map((row) => ({
    key: (row.group_key as string | null) ?? null,
    kept: Number(row.kept ?? 0),
    sent: Number(row.sent ?? 0),
    toVerify: Number(row.to_verify ?? 0),
  }));

  const listed = groups.map((group) => {
    const row = rows.find((item) => item.key === group.key);

    return {
      key: group.key as string | null,
      label: group.label as string | null,
      kept: row?.kept ?? 0,
      sent: row?.sent ?? 0,
      toVerify: row?.toVerify ?? 0,
    };
  });

  // hors groupes : clé null, et groupes qui ne sont plus proposés
  const outside = rows
    .filter((row) => !groups.some((group) => group.key === row.key))
    .reduce(
      (sum, row) => ({
        kept: sum.kept + row.kept,
        sent: sum.sent + row.sent,
        toVerify: sum.toVerify + row.toVerify,
      }),
      { kept: 0, sent: 0, toVerify: 0 },
    );

  return [
    ...listed,
    ...(outside.kept + outside.sent + outside.toVerify > 0
      ? [{ key: null, label: null, ...outside }]
      : []),
  ];
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
    /** « Un message par groupe » : les groupes de la campagne (carte « Par groupe ») ; null sinon */
    groups: Array<{ key: string; label: string }> | null;
    /** entreprises gardées d'une campagne triée ; null pour une campagne sans cible en mots */
    kept: number | null;
  },
) {
  const names = [
    ...new Set(params.templates.messages.map((message) => message.name)),
  ];

  const [sent, toVerify, contactable, perName, byGroup] = await Promise.all([
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
    params.groups
      ? groupResults(client, params.campaignId, params.groups)
      : Promise.resolve(null),
  ]);

  const groupLabel = new Map(
    (params.groups ?? []).map((group) => [group.key, group.label]),
  );
  // lettre de chaque version : comptée dans son groupe (« Pour les autres » compris) avec « Un message par groupe »
  const seenInGroup = new Map<string, number>();

  const versions = params.templates.messages.map((message, index) => {
    const counts = perName.find((row) => row.name === message.name);
    const groupKey = params.groups ? (message.group ?? '') : '';
    const position = seenInGroup.get(groupKey) ?? 0;

    seenInGroup.set(groupKey, position + 1);

    return {
      index: params.groups ? position : index,
      key: index,
      name: message.name,
      /**
       * « Un message par groupe » : nom du groupe de la version ; '' = « Pour les autres » ; null sans groupes
       * (ou groupe qui n'est plus proposé)
       */
      group: params.groups
        ? message.group
          ? (groupLabel.get(message.group) ?? null)
          : ''
        : null,
      // sans « Un message par groupe », les messages réservés à un groupe ne partent pas
      usable:
        message.body.trim() !== '' &&
        (params.groups !== null || !message.group),
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
    byGroup,
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
