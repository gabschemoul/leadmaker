'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { throwRpcError } from '~/lib/server/leadmaker/rpc-errors';

import { CreateSpaceSchema } from '../schema/space.schema';

/**
 * Crée un dossier client (un espace). Le quota du forfait est vérifié par un trigger en base,
 * qui lève une erreur 23514 (check_violation) au-delà de la limite.
 */
export const createSpaceAction = authActionClient
  .inputSchema(CreateSpaceSchema)
  .action(async ({ parsedInput: { accountId, name }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.from('lm_spaces').insert({
      account_id: accountId,
      name,
    });

    if (error) {
      if (error.code === '23514') {
        throw new Error('campaigns.folders.quotaReached');
      }

      if (error.code === '23505') {
        throw new Error('campaigns.folders.nameTaken');
      }

      await throwRpcError({
        scope: 'spaces.create',
        error,
        hints: {},
        fallback: 'campaigns.folders.createError',
        context: { accountId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/spaces', 'page');
    revalidatePath('/home/[account]/campaigns', 'layout');
    revalidatePath('/home/[account]/prospects', 'page');

    return { success: true };
  });
