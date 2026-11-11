'use server';

/**
 * Rôle : actions de « À vous de jouer » (étape Envoi en un seul écran, 12/11/2026) : envoyer un formulaire douteux
 * ou complété (il reste dans son pilote), marquer envoyé un site protégé contre les robots, passer.
 * Écritures : lm_update_attempt, lm_approve_attempts, lm_mark_sent_by_hand, lm_skip_todo (contrôle lm_member).
 */
import type { PostgrestError } from '@supabase/supabase-js';

import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { extraValues } from '~/lib/leadmaker/attempts';
import { throwRpcError } from '~/lib/server/leadmaker/rpc-errors';

import {
  ApproveTodoSchema,
  SkipTodoSchema,
  TodoAttemptSchema,
} from '../schema/envoi.schema';

function fail(
  action: string,
  error: PostgrestError,
  context: Record<string, unknown>,
): Promise<never> {
  return throwRpcError({
    scope: `envoi.${action}`,
    error,
    hints: {},
    fallback: 'campaigns.envoi.errors.generic',
    context,
  });
}

/** « Envoyer » : le formulaire part au rythme de son pilote (avec les cases remplies, s'il y en avait). */
export const approveTodoAction = authActionClient
  .inputSchema(ApproveTodoSchema)
  .action(async ({ parsedInput: input, ctx }) => {
    const client = getSupabaseServerClient();
    const context = { accountId: input.accountId, userId: ctx.user.id };

    if (input.extraValues && input.extraValues.length > 0) {
      const { data: attempt, error: readError } = await client
        .from('lm_attempts')
        .select('subject, body, extra')
        .eq('id', input.id)
        .maybeSingle();

      if (readError) {
        return fail('approve', readError, context);
      }

      if (!attempt) {
        throw new Error('campaigns.envoi.errors.gone');
      }

      const extra: Record<string, string> = {
        ...extraValues(attempt.extra),
        ...Object.fromEntries(
          input.extraValues
            .filter((item) => item.value !== '')
            .map((item) => [item.label, item.value]),
        ),
      };

      const update = await client.rpc('lm_update_attempt', {
        p_id: input.id,
        p_subject: attempt.subject ?? '',
        p_body: attempt.body ?? '',
        p_extra: extra,
      });

      if (update.error) {
        return fail('approve', update.error, context);
      }
    }

    const { data, error } = await client.rpc('lm_approve_attempts', {
      p_ids: [input.id],
    });

    if (error) {
      return fail('approve', error, context);
    }

    if (!data) {
      throw new Error(
        input.extraValues
          ? 'campaigns.envoi.errors.missing'
          : 'campaigns.envoi.errors.gone',
      );
    }

    return { count: data };
  });

/** « C'est envoyé » : site protégé, l'utilisateur a envoyé le message lui-même. */
export const markSentByHandAction = authActionClient
  .inputSchema(TodoAttemptSchema)
  .action(async ({ parsedInput: input, ctx }) => {
    const { data, error } = await getSupabaseServerClient().rpc(
      'lm_mark_sent_by_hand',
      { p_ids: [input.id] },
    );

    if (error) {
      return fail('sentByHand', error, {
        accountId: input.accountId,
        userId: ctx.user.id,
      });
    }

    if (!data) {
      throw new Error('campaigns.envoi.errors.gone');
    }

    return { count: data };
  });

/**
 * « Passer » : pas d'envoi. Seulement des formulaires encore dans la liste (lm_skip_todo) : un formulaire accepté
 * entre-temps (autre onglet, autre membre) n'est jamais passé. Sans `id` : toute la liste.
 */
export const skipTodoAction = authActionClient
  .inputSchema(SkipTodoSchema)
  .action(async ({ parsedInput: input, ctx }) => {
    const { data, error } = await getSupabaseServerClient().rpc(
      'lm_skip_todo',
      {
        p_campaign_id: input.campaignId,
        p_kind: input.kind,
        p_ids: input.id ? [input.id] : undefined,
      },
    );

    if (error) {
      return fail('skip', error, {
        accountId: input.accountId,
        userId: ctx.user.id,
      });
    }

    if (input.id && !data) {
      throw new Error('campaigns.envoi.errors.gone');
    }

    return { count: data ?? 0 };
  });
