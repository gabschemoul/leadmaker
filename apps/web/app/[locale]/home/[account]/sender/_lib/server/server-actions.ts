'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { SaveSenderProfileSchema } from '../schema/sender-profile.schema';

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

/**
 * Enregistre le profil expéditeur d'un dossier client : création la première
 * fois, mise à jour ensuite. Le RLS limite l'écriture aux dossiers de
 * l'organisation du membre.
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

    const existing = await client
      .from('lm_sender_profiles')
      .select('id')
      .eq('space_id', parsedInput.spaceId)
      .maybeSingle();

    if (existing.error) {
      throw existing.error;
    }

    const { error } = existing.data
      ? await client
          .from('lm_sender_profiles')
          .update(values)
          .eq('id', existing.data.id)
      : await client.from('lm_sender_profiles').insert({
          ...values,
          account_id: parsedInput.accountId,
          space_id: parsedInput.spaceId,
        });

    if (error) {
      // 42501 : le dossier n'appartient pas à l'organisation (refusé par le RLS)
      if (error.code === '42501' || error.code === '23503') {
        throw new Error('outreach.sender.folderNotFound');
      }

      const logger = await getLogger();

      logger.error(
        {
          name: 'leadmaker.sender.save',
          accountId: parsedInput.accountId,
          spaceId: parsedInput.spaceId,
          userId: ctx.user.id,
          error,
        },
        'Failed to save sender profile',
      );

      throw new Error('outreach.sender.saveFailed');
    }

    revalidatePath('/home/[account]/sender', 'page');

    return { success: true };
  });
