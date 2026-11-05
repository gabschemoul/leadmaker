'use server';

import { revalidatePath } from 'next/cache';

import type { PostgrestError } from '@supabase/supabase-js';

import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AUTOPILOT_ERRORS,
  throwRpcError,
} from '~/lib/server/leadmaker/rpc-errors';

import {
  AutopilotIdSchema,
  StartAutopilotSchema,
  UpdateAutopilotSchema,
} from '../schema/autopilot.schema';

/** Erreur SQL du pilote → message connu (AUTOPILOT_ERRORS) ou clé générique, journalisée. */
function fail(
  action: string,
  error: PostgrestError,
  context: Record<string, unknown>,
): Promise<never> {
  return throwRpcError({
    scope: `autopilot.${action}`,
    error,
    hints: AUTOPILOT_ERRORS,
    fallback: 'campaigns.autopilot.errors.generic',
    context,
  });
}

function refresh() {
  revalidatePath('/home/[account]/campaigns', 'layout');
}

/** Lance le pilote automatique sur une campagne (tous les forfaits). */
export const startAutopilotAction = authActionClient
  .inputSchema(StartAutopilotSchema)
  .action(async ({ parsedInput: input, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_start_autopilot', {
      p_campaign_id: input.campaignId,
      p_target: input.target,
      p_messages: input.messages,
      p_schedule: input.schedule,
      p_spread_days: input.spreadDays,
      p_preview: input.preview,
    });

    if (error) {
      return fail('start', error, {
        campaignId: input.campaignId,
        userId: ctx.user.id,
      });
    }

    refresh();

    return { autopilotId: data };
  });

/** Modifie un pilote actif : nombre, messages, moment d'envoi. */
export const updateAutopilotAction = authActionClient
  .inputSchema(UpdateAutopilotSchema)
  .action(async ({ parsedInput: input, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_update_autopilot', {
      p_autopilot_id: input.autopilotId,
      p_target: input.target,
      p_messages: input.messages,
      p_schedule: input.schedule,
      p_spread_days: input.spreadDays,
    });

    if (error) {
      return fail('update', error, {
        autopilotId: input.autopilotId,
        userId: ctx.user.id,
      });
    }

    refresh();

    return { target: data };
  });

type SimpleRpc =
  | 'lm_pause_autopilot'
  | 'lm_resume_autopilot'
  | 'lm_confirm_autopilot'
  | 'lm_cancel_autopilot';

function simpleAction(rpc: SimpleRpc, name: string) {
  return authActionClient
    .inputSchema(AutopilotIdSchema)
    .action(async ({ parsedInput: { autopilotId }, ctx }) => {
      const client = getSupabaseServerClient();

      const { error } = await client.rpc(rpc, { p_autopilot_id: autopilotId });

      if (error) {
        return fail(name, error, { autopilotId, userId: ctx.user.id });
      }

      refresh();

      return { success: true };
    });
}

/** Pause : rien n'est plus préparé ni envoyé. */
export const pauseAutopilotAction = simpleAction('lm_pause_autopilot', 'pause');

/** Reprise après une pause. */
export const resumeAutopilotAction = simpleAction(
  'lm_resume_autopilot',
  'resume',
);

/** Aperçu validé : les formulaires montrés partent, le pilote démarre. */
export const confirmAutopilotAction = simpleAction(
  'lm_confirm_autopilot',
  'confirm',
);

/** Aperçu annulé : rien n'est parti. */
export const cancelAutopilotAction = simpleAction(
  'lm_cancel_autopilot',
  'cancel',
);
