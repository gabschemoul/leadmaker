'use server';

/**
 * Rôle : actions serveur de prise de contact d'une campagne (expéditeur, messages, préparation des formulaires).
 * Données : table lm_campaigns, fonctions SQL lm_campaign_sender et lm_prepare_campaign.
 * Écritures : lm_campaigns (sender_id, templates, daily_limit, auto_validation) ; tâches de préparation pour les robots.
 */
import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { mentionsCompany, unknownVariables } from '~/lib/leadmaker/templates';
import {
  PREPARE_ERRORS,
  TEMPLATES_ERRORS,
  throwRpcError,
} from '~/lib/server/leadmaker/rpc-errors';

import {
  CampaignIdSchema,
  CampaignSenderSchema,
} from '../schema/campaign.schema';
import {
  CampaignSendingSchema,
  SaveCampaignTemplatesSchema,
} from '../schema/templates.schema';
import { isPowerUser } from './power-user';

/**
 * Choisit l'expéditeur d'une campagne (null = celui par défaut). La base
 * refuse un expéditeur d'un autre espace (lm_campaigns_check_sender) et le
 * RLS une campagne d'une autre organisation.
 */
export const setCampaignSenderAction = authActionClient
  .inputSchema(CampaignSenderSchema)
  .action(async ({ parsedInput: { campaignId, senderId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('lm_campaigns')
      .update({ sender_id: senderId })
      .eq('id', campaignId)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      if (!error || error.code === '23514' || error.code === '42501') {
        throw new Error('campaigns.steps.write.senderNotFound');
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.sender',
          campaignId,
          senderId,
          userId: ctx.user.id,
          error,
        },
        'Failed to set campaign sender',
      );

      throw new Error('campaigns.steps.write.senderChooseFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/**
 * Enregistre les messages d'une campagne. Contrôle bloquant : chaque message
 * rempli doit mentionner la société de l'expéditeur (variable {my_company} ou
 * nom en clair), pour que l'entreprise contactée sache qui lui écrit. Les
 * utilisateurs sans limite (Gabriel et Nath, power-user.ts) en sont dispensés.
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

    const [sender, companyOptional] = await Promise.all([
      // expéditeur de la campagne (choisi pour elle, sinon celui par défaut)
      client
        .rpc('lm_campaign_sender', { p_campaign_id: campaign.data.id })
        .select('company')
        .maybeSingle(),
      isPowerUser(ctx.user.id),
    ]);

    if (sender.error) throw sender.error;

    // seuls les messages remplis sont conservés ; les cases vides sont ignorées. `group` (« Un message par
    // groupe ») n'est écrit que s'il est renseigné : sans lui, le message est « Pour les autres »
    const messages = parsedInput.messages
      .map((message, index) => ({
        name: message.name || `Message ${index + 1}`,
        subject: message.subject,
        body: message.body,
        short: message.body.trim() ? message.short : '',
        ...(message.group ? { group: message.group } : {}),
      }))
      .filter((message) => message.body.trim() !== '');

    const filled = messages.flatMap((message) => [
      message,
      ...(message.short.trim()
        ? [{ subject: message.subject, body: message.short }]
        : []),
    ]);

    for (const message of filled) {
      if (unknownVariables(`${message.subject} ${message.body}`).length > 0) {
        throw new Error('outreach.messages.unknownVariable');
      }

      if (
        !companyOptional &&
        !mentionsCompany(message.body, sender.data?.company ?? null)
      ) {
        throw new Error('outreach.messages.companyMissing');
      }
    }

    const { error } = await client
      .from('lm_campaigns')
      .update({
        templates: { messages },
        daily_limit: parsedInput.dailyLimit,
        auto_validation: parsedInput.autoValidation,
      })
      .eq('id', parsedInput.campaignId);

    if (error) {
      // validation automatique hors forfait : hint levé par le déclencheur SQL
      await throwRpcError({
        scope: 'campaigns.templates',
        error,
        hints: TEMPLATES_ERRORS,
        fallback: 'outreach.messages.saveFailed',
        context: { campaignId: parsedInput.campaignId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true, count: filled.length };
  });

/** Prépare les formulaires de tous les prospects d'une campagne pas encore traités. */
export const prepareCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_prepare_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.prepare',
        error,
        hints: PREPARE_ERRORS,
        fallback: 'outreach.forms.prepare.failed',
        context: { campaignId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/forms', 'page');

    return { queued: data?.[0]?.queued ?? 0, skipped: data?.[0]?.skipped ?? 0 };
  });

/**
 * Réglages d'envoi du mode avancé : nombre maximal d'envois par jour et validation automatique des formulaires
 * sans alerte (le pilote automatique a son propre rythme). Le déclencheur SQL refuse la validation automatique
 * sans forfait (hint « plan »).
 */
export const saveCampaignSendingAction = authActionClient
  .inputSchema(CampaignSendingSchema)
  .action(async ({ parsedInput, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('lm_campaigns')
      .update({
        daily_limit: parsedInput.dailyLimit,
        auto_validation: parsedInput.autoValidation,
      })
      .eq('id', parsedInput.campaignId)
      .select('id');

    if (error) {
      await throwRpcError({
        scope: 'campaigns.sending',
        error,
        hints: TEMPLATES_ERRORS,
        fallback: 'outreach.messages.saveFailed',
        context: { campaignId: parsedInput.campaignId, userId: ctx.user.id },
      });
    }

    if (!data?.length) {
      throw new Error('outreach.messages.campaignNotFound');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });
