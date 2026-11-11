'use server';

/**
 * Rôle : actions serveur du cycle de vie d'une campagne (créer, modifier, dupliquer, archiver, lancer, pause, ordinateur dédié).
 * Données : table lm_campaigns et fonctions SQL lm_update/duplicate/start/pause_campaign, lm_set_campaign_archived, lm_set_local_discovery.
 * Écritures : lm_campaigns (insertion, ciblage, statut) ; le lancement met des recherches en file pour les robots.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getLocale } from 'next-intl/server';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  START_ERRORS,
  UPDATE_CAMPAIGN_ERRORS,
  throwRpcError,
} from '~/lib/server/leadmaker/rpc-errors';

import {
  ArchiveCampaignSchema,
  CampaignIdSchema,
  CreateCampaignSchema,
  DuplicateCampaignSchema,
  type LaunchError,
  LocalDiscoverySchema,
  ACTIVITIES_TARGETS,
  MAX_CATEGORIES,
  UpdateCampaignSchema,
  buildFilters,
  buildTargeting,
  isActivitiesTarget,
} from '../schema/campaign.schema';
import { getCategoryLimit } from './power-user';

/** Plus d'activités que la limite de l'utilisateur (1 000, sauf Gabriel et Nath) : refusé. */
async function assertCategoryLimit(count: number, userId: string) {
  if (count > MAX_CATEGORIES && count > (await getCategoryLimit(userId))) {
    throw new Error('campaigns.errors.tooManyCategories');
  }
}

type Client = SupabaseClient<Database>;

/**
 * Phrase facultative (11/11) : sans phrase, la cible envoyée au tri est une phrase fixe (« Toutes les entreprises
 * des activités choisies, sans autre critère ») : le tri garde les entreprises trouvées, et la campagne reste payée
 * par entreprise gardée comme les autres. Phrase fixe, sans la liste des activités : ajouter une activité ne
 * relance pas le tri de toute la campagne. Une campagne qui en a déjà une la garde (même langue qu'au départ).
 */
async function targetFromActivities(previous?: string | null) {
  if (isActivitiesTarget(previous)) {
    return (previous ?? '').trim();
  }

  const locale = await getLocale();

  return locale.startsWith('fr')
    ? ACTIVITIES_TARGETS.fr
    : ACTIVITIES_TARGETS.en;
}

/** Refus de lm_start_campaign → code affiché sur la page de la campagne (`?erreur=`). */
const START_LAUNCH_ERRORS: Record<string, LaunchError> = {
  no_credits: 'noCredits',
  campaign_limit: 'campaignLimit',
  no_cities: 'noCities',
  archived: 'archived',
};

async function logLaunchError(
  name: string,
  context: Record<string, unknown>,
  error: unknown,
) {
  const logger = await getLogger();
  logger.error(
    { name: `leadmaker.campaigns.${name}`, ...context, error },
    'Campaign launch step failed',
  );
}

/**
 * Écran « Qui ? » : enregistre l'offre, puis la cible si elle a changé (lm_set_sort_target : nouvelle cible =
 * tout est retrié). Renvoie un code d'erreur, ou null. Ne lève pas : la campagne existe déjà.
 * Offre (10/11/2026) : la première devient celle du dossier (Réglages) ; ensuite, une offre différente de celle
 * du dossier est propre à la campagne (lm_set_campaign_offer), une offre identique revient à celle du dossier.
 */
async function saveOfferAndTarget(
  client: Client,
  params: {
    campaignId: string;
    spaceId: string;
    offer: string;
    sortTarget: string;
    previousTarget: string | null;
    userId: string;
  },
): Promise<LaunchError | null> {
  const context = { campaignId: params.campaignId, userId: params.userId };

  const [{ data: space }, { data: campaign }] = await Promise.all([
    client
      .from('lm_spaces')
      .select('offer')
      .eq('id', params.spaceId)
      .maybeSingle(),
    client
      .from('lm_campaigns')
      .select('offer')
      .eq('id', params.campaignId)
      .maybeSingle(),
  ]);

  const spaceOffer = (space?.offer ?? '').trim();
  const campaignOffer = (campaign?.offer ?? '').trim();
  // offre propre à la campagne voulue : aucune si c'est celle du dossier (ou si le dossier n'en a pas encore)
  const wantedCampaignOffer =
    spaceOffer === '' || params.offer === spaceOffer ? '' : params.offer;

  if (spaceOffer === '' && params.offer !== '') {
    const { error } = await client.rpc('lm_set_space_offer', {
      p_space_id: params.spaceId,
      p_offer: params.offer,
    });

    if (error) {
      await logLaunchError('offer', context, error);

      return 'offerFailed';
    }
  }

  if (campaignOffer !== wantedCampaignOffer) {
    const { error } = await client.rpc('lm_set_campaign_offer', {
      p_campaign_id: params.campaignId,
      p_offer: wantedCampaignOffer,
    });

    if (error) {
      await logLaunchError('offer', context, error);

      return 'offerFailed';
    }
  }

  if ((params.previousTarget ?? '').trim() !== params.sortTarget) {
    const { error } = await client.rpc('lm_set_sort_target', {
      p_campaign_id: params.campaignId,
      p_target: params.sortTarget,
    });

    if (error) {
      await logLaunchError('sortTarget', context, error);

      return 'sortFailed';
    }
  }

  return null;
}

/** Démarre la campagne tout de suite (lm_start_campaign, sans attendre d'estimation). Code d'erreur ou null. */
async function startNow(
  client: Client,
  campaignId: string,
  userId: string,
): Promise<LaunchError | null> {
  const { error } = await client.rpc('lm_start_campaign', {
    p_campaign_id: campaignId,
  });

  if (!error) {
    return null;
  }

  const known = error.hint ? START_LAUNCH_ERRORS[error.hint] : undefined;

  if (known) {
    return known;
  }

  await logLaunchError('start', { campaignId, userId }, error);

  return 'startFailed';
}

function companiesHref(
  accountSlug: string,
  campaignId: string,
  launchError: LaunchError | null,
) {
  const base = `/home/${accountSlug}/campaigns/${campaignId}?etape=trouver`;

  return launchError ? `${base}&erreur=${launchError}` : base;
}

/**
 * Écran « Qui ? », « Lancer la recherche » : enregistre la campagne, l'offre du dossier et la cible, puis
 * démarre la recherche sans écran d'estimation (le prix se mesure sur les premières entreprises triées).
 * Ouvre ensuite « Vos entreprises ». Si une étape échoue, la campagne reste en brouillon et sa page affiche
 * pourquoi (jamais de lancement sans cible : elle serait payée à l'ancienne).
 */
export const createCampaignAction = authActionClient
  .inputSchema(CreateCampaignSchema)
  .action(async ({ parsedInput: values, ctx }) => {
    await assertCategoryLimit(values.categories.length, ctx.user.id);

    const targeting = buildTargeting(values);

    if (!targeting) {
      throw new Error('campaigns.errors.targetingIncomplete');
    }

    const client = getSupabaseServerClient();
    // brouillon compris : sans phrase, la cible fixe (l'écran Entreprises du brouillon est celui d'une campagne triée)
    const sortTarget = values.sortTarget || (await targetFromActivities());

    const { data, error } = await client
      .from('lm_campaigns')
      .insert({
        account_id: values.accountId,
        space_id: values.spaceId,
        name: values.name,
        country_code: values.countryCode,
        targeting,
        filters: buildFilters(values),
      })
      .select('id')
      .single();

    if (error || !data) {
      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.create',
          accountId: values.accountId,
          userId: ctx.user.id,
          error,
        },
        'Failed to create campaign',
      );

      throw new Error('campaigns.errors.createFailed');
    }

    const saveError = await saveOfferAndTarget(client, {
      campaignId: data.id,
      spaceId: values.spaceId,
      offer: values.offer,
      sortTarget,
      previousTarget: null,
      userId: ctx.user.id,
    });

    revalidatePath('/home/[account]/campaigns', 'layout');

    // « Enregistrer en brouillon » : rien n'est lancé ; on ouvre la page du brouillon (Cible, Prospects… et
    // « Lancer la recherche »), qui dit aussi pourquoi si l'offre n'a pas pu être enregistrée (retour du 11/11)
    if (!values.launch) {
      redirect(
        saveError
          ? companiesHref(values.accountSlug, data.id, saveError)
          : `/home/${values.accountSlug}/campaigns/${data.id}`,
      );
    }

    const launchError =
      saveError ?? (await startNow(client, data.id, ctx.user.id));

    redirect(companiesHref(values.accountSlug, data.id, launchError));
  });

/**
 * Modifie une campagne, même lancée : les villes et activités ajoutées
 * rejoignent la file de scan, celles retirées sont sautées. Une campagne
 * terminée qui reçoit du travail est relancée.
 * Écran « Qui ? » : une nouvelle cible relance le tri de toutes ses entreprises ; un brouillon avec une
 * cible est lancé tout de suite (« Lancer la recherche »).
 */
export const updateCampaignAction = authActionClient
  .inputSchema(UpdateCampaignSchema)
  .action(async ({ parsedInput: values, ctx }) => {
    await assertCategoryLimit(values.categories.length, ctx.user.id);

    const targeting = buildTargeting(values);

    if (!targeting) {
      throw new Error('campaigns.errors.targetingIncomplete');
    }

    const client = getSupabaseServerClient();

    // statut AVANT la modification : seule une campagne terminée est relancée
    // d'office ; une campagne mise en pause par l'utilisateur reste en pause
    const { data: before } = await client
      .from('lm_campaigns')
      .select('status, sort_target, space_id')
      .eq('id', values.campaignId)
      .maybeSingle();

    // Sans phrase : cible fixe « toutes les entreprises des activités choisies » (brouillon compris). Une ancienne
    // campagne lancée sans cible garde l'ancien parcours.
    const isDraft = before?.status === 'draft';
    const keepsLegacy = !isDraft && !before?.sort_target?.trim();
    const sortTarget =
      values.sortTarget ||
      (keepsLegacy ? '' : await targetFromActivities(before?.sort_target));

    const { data: status, error } = await client.rpc('lm_update_campaign', {
      p_campaign_id: values.campaignId,
      p_name: values.name,
      p_country_code: values.countryCode,
      p_targeting: targeting,
      p_filters: buildFilters(values),
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.update',
        error,
        hints: UPDATE_CAMPAIGN_ERRORS,
        fallback: 'campaigns.errors.updateFailed',
        context: { campaignId: values.campaignId, userId: ctx.user.id },
      });
    }

    let launchError: LaunchError | null = null;

    if (sortTarget.length > 0 && before) {
      launchError = await saveOfferAndTarget(client, {
        campaignId: values.campaignId,
        spaceId: before.space_id,
        offer: values.offer,
        sortTarget,
        previousTarget: before.sort_target,
        userId: ctx.user.id,
      });
    }

    // Brouillon : « Lancer la recherche » le démarre (jamais sans sa cible) ; « Enregistrer en brouillon » non
    if (isDraft && !values.launch) {
      revalidatePath('/home/[account]/campaigns', 'layout');

      redirect(`/home/${values.accountSlug}/campaigns/${values.campaignId}`);
    }

    if (!launchError && isDraft && sortTarget.length > 0) {
      launchError = await startNow(client, values.campaignId, ctx.user.id);
    }

    // Terminée puis complétée : on la relance tout de suite. Si la reprise est
    // refusée (crédits, forfait), la campagne reste en pause avec « Reprendre ».
    // Une campagne déjà en pause avant la modification n'est jamais relancée.
    if (!launchError && before?.status === 'completed' && status === 'paused') {
      await client.rpc('lm_start_campaign', {
        p_campaign_id: values.campaignId,
      });
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    redirect(
      sortTarget.length > 0
        ? companiesHref(values.accountSlug, values.campaignId, launchError)
        : `/home/${values.accountSlug}/campaigns/${values.campaignId}`,
    );
  });

/** Copie une campagne en brouillon et ouvre le formulaire de la copie. */
export const duplicateCampaignAction = authActionClient
  .inputSchema(DuplicateCampaignSchema)
  .action(async ({ parsedInput: { campaignId, accountSlug, name }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data: id, error } = await client.rpc('lm_duplicate_campaign', {
      p_campaign_id: campaignId,
      p_name: name,
    });

    if (error || !id) {
      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.duplicate',
          campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to duplicate campaign',
      );

      throw new Error('campaigns.errors.duplicateFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    redirect(`/home/${accountSlug}/campaigns/${id}/edit`);
  });

/**
 * Archive ou désarchive une campagne (audit E18) : archivée, elle disparaît de la liste et du tableau de bord,
 * sa recherche et son pilote s'arrêtent, les formulaires validés pas encore partis sont retenus.
 */
export const archiveCampaignAction = authActionClient
  .inputSchema(ArchiveCampaignSchema)
  .action(async ({ parsedInput: { campaignId, archived }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_set_campaign_archived', {
      p_campaign_id: campaignId,
      p_archived: archived,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.archive',
        error,
        hints: {},
        fallback: 'campaigns.errors.archiveFailed',
        context: { campaignId, archived, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]', 'layout');

    return { status: data };
  });

/**
 * Lance ou reprend une campagne, tout de suite (4/11/2026) : sans estimation terminée, la mesure de la
 * difficulté tourne en parallèle et fixe le tarif quand elle se termine (lm_start_campaign).
 */
export const startCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_start_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.start',
        error,
        hints: START_ERRORS,
        fallback: 'campaigns.errors.startFailed',
        context: { campaignId, userId: ctx.user.id },
      });
    }

    // « Reprendre » relance aussi les envois mis en pause avec la campagne
    await setAutopilotRunning(client, campaignId, true, ctx.user.id);

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/**
 * Pilote automatique de la campagne mis en pause ou repris avec elle (analyse UX E-12, 11/11/2026 : « Mettre en
 * pause » n'arrêtait que la recherche, le pilote continuait d'envoyer). Un échec ne bloque pas la pause/reprise
 * de la recherche : il est seulement noté dans les journaux.
 */
async function setAutopilotRunning(
  client: Client,
  campaignId: string,
  running: boolean,
  userId: string,
) {
  const { data: autopilot } = await client
    .from('lm_autopilots')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', running ? 'paused' : 'running')
    .maybeSingle();

  if (!autopilot) {
    return;
  }

  const { error } = await client.rpc(
    running ? 'lm_resume_autopilot' : 'lm_pause_autopilot',
    { p_autopilot_id: autopilot.id },
  );

  if (error) {
    await logLaunchError(
      running ? 'autopilotResume' : 'autopilotPause',
      { campaignId, userId },
      error,
    );
  }
}

/** Met une campagne en pause : la recherche et les envois du pilote automatique. */
export const pauseCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_pause_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.pause',
        error,
        hints: {},
        fallback: 'campaigns.errors.pauseFailed',
        context: { campaignId, userId: ctx.user.id },
      });
    }

    await setAutopilotRunning(client, campaignId, false, ctx.user.id);

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/**
 * Fait chercher la campagne sur l'ordinateur dédié (sans proxy) ou la remet
 * sur les serveurs. Réservé aux utilisateurs listés en base (contrôlé par
 * lm_set_local_discovery).
 */
export const setLocalDiscoveryAction = authActionClient
  .inputSchema(LocalDiscoverySchema)
  .action(async ({ parsedInput: { campaignId, enabled }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_set_local_discovery', {
      p_campaign_id: campaignId,
      p_enabled: enabled,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.localDiscovery',
        error,
        hints: {},
        fallback: 'campaigns.localDiscovery.failed',
        context: { campaignId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { enabled };
  });
