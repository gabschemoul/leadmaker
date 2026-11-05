'use server';

import { revalidatePath } from 'next/cache';

import * as z from 'zod';

import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { throwRpcError } from '~/lib/server/leadmaker/rpc-errors';

/** Groupes de notifications e-mail qu'un utilisateur peut couper (voir schéma 35, lm_notification_preferences). */
const NotificationPreferencesSchema = z.object({
  disabledGroups: z.array(z.enum(['autopilot', 'search', 'credits'])).max(3),
});

/** Enregistre les notifications e-mail coupées par l'utilisateur connecté (pour toutes ses équipes). */
export const saveNotificationPreferencesAction = authActionClient
  .inputSchema(NotificationPreferencesSchema)
  .action(async ({ parsedInput: { disabledGroups }, ctx }) => {
    const client = getSupabaseServerClient();

    const groups = [...new Set(disabledGroups)];

    // mise à jour d'abord, création sinon (un « upsert » réécrirait user_id, colonne non modifiable)
    const updated = await client
      .from('lm_notification_preferences')
      .update({ disabled_groups: groups })
      .eq('user_id', ctx.user.id)
      .select('user_id');

    const { error } =
      updated.error || updated.data?.length
        ? updated
        : await client
            .from('lm_notification_preferences')
            .insert({ user_id: ctx.user.id, disabled_groups: groups });

    if (error) {
      await throwRpcError({
        scope: 'notifications.preferences',
        error,
        hints: {},
        fallback: 'account.notifications.saveFailed',
        context: { userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/settings/profile', 'page');

    return { success: true };
  });
