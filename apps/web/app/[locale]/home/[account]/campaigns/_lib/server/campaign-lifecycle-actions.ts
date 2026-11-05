'use server';

/**
 * Rôle : actions serveur du cycle de vie d'une campagne (créer, modifier, dupliquer, archiver, lancer, pause, ordinateur dédié).
 * Données : table lm_campaigns et fonctions SQL lm_update/duplicate/start/pause_campaign, lm_set_campaign_archived, lm_set_local_discovery.
 * Écritures : lm_campaigns (insertion, ciblage, statut) ; le lancement met des recherches en file pour les robots.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
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
  LocalDiscoverySchema,
  MAX_CATEGORIES,
  UpdateCampaignSchema,
  buildFilters,
  buildTargeting,
} from '../schema/campaign.schema';
import { getCategoryLimit } from './power-user';

/** Plus d'activités que la limite de l'utilisateur (1 000, sauf Gabriel et Nath) : refusé. */
async function assertCategoryLimit(count: number, userId: string) {
  if (count > MAX_CATEGORIES && count > (await getCategoryLimit(userId))) {
    throw new Error('campaigns.errors.tooManyCategories');
  }
}

/** Enregistre la campagne en brouillon puis ouvre sa page. */
export const createCampaignAction = authActionClient
  .inputSchema(CreateCampaignSchema)
  .action(async ({ parsedInput: values, ctx }) => {
    await assertCategoryLimit(values.categories.length, ctx.user.id);

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
      .select('status')
      .eq('id', values.campaignId)
      .maybeSingle();

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

    // Terminée puis complétée : on la relance tout de suite. Si la reprise est
    // refusée (crédits, forfait), la campagne reste en pause avec « Reprendre ».
    // Une campagne déjà en pause avant la modification n'est jamais relancée.
    if (before?.status === 'completed' && status === 'paused') {
      await client.rpc('lm_start_campaign', {
        p_campaign_id: values.campaignId,
      });
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    redirect(`/home/${values.accountSlug}/campaigns/${values.campaignId}`);
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
      await throwRpcError({
        scope: 'campaigns.pause',
        error,
        hints: {},
        fallback: 'campaigns.errors.pauseFailed',
        context: { campaignId, userId: ctx.user.id },
      });
    }

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
