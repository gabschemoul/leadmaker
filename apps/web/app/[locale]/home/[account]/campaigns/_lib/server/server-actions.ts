'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CampaignIdSchema,
  CreateCampaignSchema,
  EstimateCampaignSchema,
  SearchCategoriesSchema,
  SearchCitiesSchema,
  buildFilters,
  buildTargeting,
} from '../schema/campaign.schema';

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
      p_filters: filters,
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
