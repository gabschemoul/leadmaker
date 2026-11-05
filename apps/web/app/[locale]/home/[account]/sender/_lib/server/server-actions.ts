'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import pathsConfig from '~/config/paths.config';
import { throwRpcError } from '~/lib/server/leadmaker/rpc-errors';

import {
  SaveSenderProfileSchema,
  SenderIdSchema,
} from '../schema/sender-profile.schema';

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

/**
 * Enregistre un expéditeur : modification de `senderId`, sinon création d'un
 * nouvel expéditeur (le premier de l'organisation devient celui par défaut).
 * Le RLS limite l'écriture aux expéditeurs de l'organisation du membre.
 */
export const saveSenderProfileAction = authActionClient
  .inputSchema(SaveSenderProfileSchema)
  .action(async ({ parsedInput, ctx }) => {
    const client = getSupabaseServerClient();

    const values = {
      civility: orNull(parsedInput.civility),
      first_name: parsedInput.firstName,
      last_name: parsedInput.lastName,
      job_title: orNull(parsedInput.jobTitle),
      company: parsedInput.company,
      email: parsedInput.email,
      phone: orNull(parsedInput.phone),
      website: orNull(parsedInput.website),
      address: orNull(parsedInput.address),
      zip: orNull(parsedInput.zip),
      city: orNull(parsedInput.city),
      country_code: parsedInput.countryCode,
    };

    const result = parsedInput.senderId
      ? await client
          .from('lm_sender_profiles')
          .update(values)
          .eq('id', parsedInput.senderId)
          .select('id')
          .maybeSingle()
      : await client
          .from('lm_sender_profiles')
          .insert({
            ...values,
            account_id: parsedInput.accountId,
            space_id: parsedInput.spaceId,
          })
          .select('id')
          .single();

    // 42501 / 23503 : l'espace n'appartient pas à l'organisation (RLS) ; aucune ligne : expéditeur introuvable
    if (
      result.error?.code === '42501' ||
      result.error?.code === '23503' ||
      (!result.error && !result.data)
    ) {
      throw new Error('outreach.sender.notFound');
    }

    if (result.error || !result.data) {
      const logger = await getLogger();

      logger.error(
        {
          name: 'leadmaker.sender.save',
          accountId: parsedInput.accountId,
          spaceId: parsedInput.spaceId,
          senderId: parsedInput.senderId,
          userId: ctx.user.id,
          error: result.error,
        },
        'Failed to save sender profile',
      );

      throw new Error('outreach.sender.saveFailed');
    }

    revalidatePath('/home/[account]/sender', 'page');
    revalidatePath('/home/[account]/campaigns', 'layout');

    if (!parsedInput.senderId) {
      // nouvel expéditeur : la page s'ouvre sur lui
      redirect(
        `${pathsConfig.app.accountSender.replace('[account]', parsedInput.accountSlug)}?sender=${result.data.id}`,
      );
    }

    return { success: true };
  });

/** Choisit l'expéditeur par défaut (celui des campagnes qui n'en choisissent pas). */
export const setDefaultSenderAction = authActionClient
  .inputSchema(SenderIdSchema)
  .action(async ({ parsedInput: { senderId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_set_default_sender', {
      p_sender_id: senderId,
    });

    if (error) {
      if (error.code === 'P0002') {
        throw new Error('outreach.sender.notFound');
      }

      await throwRpcError({
        scope: 'sender.default',
        error,
        hints: {},
        fallback: 'outreach.sender.saveFailed',
        context: { senderId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/sender', 'page');
    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/**
 * Supprime un expéditeur. Les campagnes qui l'utilisaient repassent sur
 * l'expéditeur par défaut ; s'il était celui par défaut, le plus ancien des
 * autres le remplace (déclencheurs de 22-leadmaker-spaces.sql). Réservé aux
 * membres qui gèrent les réglages (RLS).
 */
export const deleteSenderAction = authActionClient
  .inputSchema(SenderIdSchema)
  .action(async ({ parsedInput: { senderId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('lm_sender_profiles')
      .delete()
      .eq('id', senderId)
      .select('id');

    if (error) {
      const logger = await getLogger();

      logger.error(
        {
          name: 'leadmaker.sender.delete',
          senderId,
          userId: ctx.user.id,
          error,
        },
        'Failed to delete sender',
      );

      throw new Error('outreach.sender.deleteFailed');
    }

    if (!data?.length) {
      throw new Error('outreach.sender.deleteForbidden');
    }

    revalidatePath('/home/[account]/sender', 'page');
    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });
