'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { throwRpcError } from '~/lib/server/leadmaker/rpc-errors';

import { SaveSpaceOfferSchema } from '../schema/space-offer.schema';

/**
 * Enregistre « Votre offre » d'un dossier (lm_set_space_offer, contrôle d'accès lm_member). Les campagnes
 * déjà triées ne sont pas retriées : seules les entreprises triées ensuite en tiennent compte.
 */
export const saveSpaceOfferAction = authActionClient
  .inputSchema(SaveSpaceOfferSchema)
  .action(async ({ parsedInput: { spaceId, offer }, ctx }) => {
    const { error } = await getSupabaseServerClient().rpc(
      'lm_set_space_offer',
      { p_space_id: spaceId, p_offer: offer },
    );

    if (error) {
      await throwRpcError({
        scope: 'settings.offer',
        error,
        hints: {},
        fallback: 'teams.settings.offer.saveFailed',
        context: { spaceId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/settings', 'page');

    return { success: true };
  });
