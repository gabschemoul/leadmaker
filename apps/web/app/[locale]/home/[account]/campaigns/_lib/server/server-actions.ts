'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { mentionsCompany, unknownVariables } from '~/lib/leadmaker/templates';

import {
  RequestEstimateSchema,
  CampaignIdSchema,
  CreateCampaignSchema,
  EstimateCampaignSchema,
  SearchCategoriesSchema,
  SearchCitiesSchema,
  UpdateCampaignSchema,
  buildFilters,
  buildTargeting,
} from '../schema/campaign.schema';
import { SaveCampaignTemplatesSchema } from '../schema/templates.schema';

/** Échappe les jokers de LIKE (% et _) saisis par l'utilisateur. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function stripAccents(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Autocomplétion des villes d'un pays, par début de nom (sans accents), des
 * plus peuplées aux moins peuplées.
 */
export const searchCitiesAction = authActionClient
  .inputSchema(SearchCitiesSchema)
  .action(async ({ parsedInput: { countryCode, query } }) => {
    const client = getSupabaseServerClient();
    const prefix = escapeLike(stripAccents(query));

    const { data, error } = await client
      .from('lm_geo_cities')
      .select('geoname_id, name, population')
      .eq('country_code', countryCode)
      .ilike('ascii_name', `${prefix}%`)
      .order('population', { ascending: false })
      .limit(20);

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.cities.search', error },
        'City search failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    return (data ?? []).map((city) => ({
      geonameId: city.geoname_id,
      name: city.name,
      population: city.population,
    }));
  });

/** Autocomplétion des catégories Google (libellé français ou anglais). */
export const searchCategoriesAction = authActionClient
  .inputSchema(SearchCategoriesSchema)
  .action(async ({ parsedInput: { query } }) => {
    const client = getSupabaseServerClient();

    // caractères qui casseraient la syntaxe du filtre `or` de PostgREST,
    // et jokers LIKE (retirés plutôt qu'échappés : l'échappement n'est pas
    // fiable à l'intérieur d'un filtre `or`)
    const term = query.replace(/[,()"*:\\%_]/g, ' ').trim();

    if (!term) {
      return [];
    }

    const { data, error } = await client
      .from('lm_categories')
      .select('gcid, label_fr, label_en, family')
      .eq('is_excluded', false)
      .or(`label_fr.ilike.%${term}%,label_en.ilike.%${term}%`)
      .order('is_generic', { ascending: false })
      .order('label_fr', { ascending: true })
      .limit(30);

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.categories.search', error },
        'Category search failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    return (data ?? []).map((category) => ({
      gcid: category.gcid,
      labelFr: category.label_fr,
      labelEn: category.label_en,
      family: category.family,
    }));
  });

/** Estimation avant lancement : villes, recherches et prospects attendus. */
export const estimateCampaignAction = authActionClient
  .inputSchema(EstimateCampaignSchema)
  .action(async ({ parsedInput: { countryCode, targeting, filters } }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_estimate_campaign', {
      p_country_code: countryCode,
      p_targeting: targeting,
      p_filters: filters ?? {},
    });

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.campaigns.estimate', error },
        'Campaign estimate failed',
      );

      throw new Error('campaigns.errors.estimateFailed');
    }

    const row = data?.[0];

    return {
      cities: row?.cities ?? 0,
      categories: row?.categories ?? 0,
      searches: row?.searches ?? 0,
      expectedProspects: row?.expected_prospects ?? 0,
    };
  });

/** Enregistre la campagne en brouillon puis ouvre sa page. */
/**
 * Estimation réelle : le worker lit Google Maps (sans ouvrir les fiches, sans crédit)
 * et compte les entreprises qui passent les filtres. Renvoie l'identifiant à suivre.
 */
export const requestEstimateAction = authActionClient
  .inputSchema(RequestEstimateSchema)
  .action(
    async ({ parsedInput: { accountId, countryCode, targeting, filters } }) => {
      const client = getSupabaseServerClient();

      const { data, error } = await client.rpc('lm_request_estimate', {
        p_account_id: accountId,
        p_country_code: countryCode,
        p_targeting: targeting,
        p_filters: filters,
      });

      if (error || !data) {
        const logger = await getLogger();
        logger.error(
          { name: 'leadmaker.campaigns.real-estimate', accountId, error },
          'Real estimate request failed',
        );

        throw new Error('campaigns.errors.estimateFailed');
      }

      return { estimateId: data };
    },
  );

export const createCampaignAction = authActionClient
  .inputSchema(CreateCampaignSchema)
  .action(async ({ parsedInput: values, ctx }) => {
    const targeting = buildTargeting(values);

    if (!targeting) {
      throw new Error('campaigns.errors.targetingIncomplete');
    }

    const client = getSupabaseServerClient();

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

    revalidatePath('/home/[account]/campaigns', 'page');

    redirect(`/home/${values.accountSlug}/campaigns/${data.id}`);
  });

/**
 * Modifie une campagne, même lancée : les villes et activités ajoutées
 * rejoignent la file de scan, celles retirées sont sautées. Une campagne
 * terminée qui reçoit du travail est relancée.
 */
export const updateCampaignAction = authActionClient
  .inputSchema(UpdateCampaignSchema)
  .action(async ({ parsedInput: values, ctx }) => {
    const targeting = buildTargeting(values);

    if (!targeting) {
      throw new Error('campaigns.errors.targetingIncomplete');
    }

    const client = getSupabaseServerClient();

    const { data: status, error } = await client.rpc('lm_update_campaign', {
      p_campaign_id: values.campaignId,
      p_name: values.name,
      p_country_code: values.countryCode,
      p_targeting: targeting,
      p_filters: buildFilters(values),
    });

    if (error) {
      if (error.hint === 'country_locked') {
        throw new Error('campaigns.errors.countryLocked');
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.update',
          campaignId: values.campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to update campaign',
      );

      throw new Error('campaigns.errors.updateFailed');
    }

    // Terminée puis complétée : on la relance tout de suite. Si la reprise est
    // refusée (crédits, forfait), la campagne reste en pause avec « Reprendre ».
    if (status === 'paused') {
      await client.rpc('lm_start_campaign', {
        p_campaign_id: values.campaignId,
      });
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    redirect(`/home/${values.accountSlug}/campaigns/${values.campaignId}`);
  });

const START_ERRORS: Record<string, string> = {
  no_credits: 'campaigns.errors.noCredits',
  campaign_limit: 'campaigns.errors.campaignLimit',
  no_cities: 'campaigns.errors.noCities',
};

/** Lance ou reprend une campagne. */
export const startCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_start_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      const known = error.hint ? START_ERRORS[error.hint] : undefined;

      if (known) {
        throw new Error(known);
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.start',
          campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to start campaign',
      );

      throw new Error('campaigns.errors.startFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/** Met une campagne en pause. */
export const pauseCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_pause_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.pause',
          campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to pause campaign',
      );

      throw new Error('campaigns.errors.pauseFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/**
 * Enregistre les messages d'une campagne. Contrôle bloquant : chaque message
 * rempli doit mentionner la société de l'expéditeur (variable {my_company} ou
 * nom en clair), pour que l'entreprise contactée sache qui lui écrit.
 */
export const saveCampaignTemplatesAction = authActionClient
  .inputSchema(SaveCampaignTemplatesSchema)
  .action(async ({ parsedInput, ctx }) => {
    const client = getSupabaseServerClient();

    const campaign = await client
      .from('lm_campaigns')
      .select('id, space_id')
      .eq('id', parsedInput.campaignId)
      .maybeSingle();

    if (campaign.error) throw campaign.error;

    if (!campaign.data) {
      throw new Error('outreach.messages.campaignNotFound');
    }

    const sender = await client
      .from('lm_sender_profiles')
      .select('company')
      .eq('space_id', campaign.data.space_id)
      .maybeSingle();

    if (sender.error) throw sender.error;

    // seuls les messages remplis sont conservés ; les cases vides sont ignorées
    const messages = parsedInput.messages
      .map((message, index) => ({
        name: message.name || `Message ${index + 1}`,
        subject: message.subject,
        body: message.body,
      }))
      .filter((message) => message.body.trim() !== '');

    const filled = [
      ...messages,
      ...(parsedInput.short.body.trim() ? [parsedInput.short] : []),
    ];

    for (const message of filled) {
      if (unknownVariables(`${message.subject} ${message.body}`).length > 0) {
        throw new Error('outreach.messages.unknownVariable');
      }

      if (!mentionsCompany(message.body, sender.data?.company ?? null)) {
        throw new Error('outreach.messages.companyMissing');
      }
    }

    const { error } = await client
      .from('lm_campaigns')
      .update({
        templates: { messages, short: parsedInput.short },
        daily_limit: parsedInput.dailyLimit,
        auto_validation: parsedInput.autoValidation,
      })
      .eq('id', parsedInput.campaignId);

    if (error) {
      // validation automatique hors forfait (contrôle du déclencheur SQL)
      if (error.hint === 'plan') {
        throw new Error('outreach.messages.autoValidationPlan');
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.templates',
          campaignId: parsedInput.campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to save campaign templates',
      );

      throw new Error('outreach.messages.saveFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true, count: filled.length };
  });

const PREPARE_ERRORS: Record<string, string> = {
  no_sender: 'outreach.forms.prepare.noSender',
  no_messages: 'outreach.forms.prepare.noMessages',
  cap_reached: 'outreach.forms.prepare.capReached',
};

/** Prépare les formulaires de tous les prospects d'une campagne pas encore traités. */
export const prepareCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_prepare_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      const known = error.hint ? PREPARE_ERRORS[error.hint] : undefined;

      if (known) {
        throw new Error(known);
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.prepare',
          campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to queue campaign form preparation',
      );

      throw new Error('outreach.forms.prepare.failed');
    }

    revalidatePath('/home/[account]/forms', 'page');

    return { queued: data?.[0]?.queued ?? 0, skipped: data?.[0]?.skipped ?? 0 };
  });
