'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { throwRpcError } from '~/lib/server/leadmaker/rpc-errors';

import {
  AttemptIdsSchema,
  MarkAttemptsSchema,
  UpdateAttemptSchema,
} from '../schema/forms-actions.schema';

type BulkOperation = 'validate' | 'skip' | 'exclude';

const RPC_BY_OPERATION = {
  validate: 'lm_validate_attempts',
  skip: 'lm_skip_attempts',
  exclude: 'lm_exclude_attempts',
} as const;

function revalidateForms() {
  revalidatePath('/home/[account]/forms', 'page');
  revalidatePath('/home/[account]/prospects', 'page');
  // les formulaires se vérifient aussi dans l'étape Contacter d'une campagne
  revalidatePath('/home/[account]/campaigns', 'layout');
}

async function runBulk(
  operation: BulkOperation,
  params: { ids: string[]; accountId: string; userId: string },
) {
  const client = getSupabaseServerClient();

  const { data, error } = await client.rpc(RPC_BY_OPERATION[operation], {
    p_ids: params.ids,
  });

  if (error) {
    await throwRpcError({
      scope: `forms.${operation}`,
      error,
      hints: {},
      fallback: 'outreach.forms.actions.failed',
      context: { accountId: params.accountId, userId: params.userId },
    });
  }

  revalidateForms();

  return { count: data ?? 0 };
}

/** Valide des formulaires prêts (ou complétés) : ils partiront à l'étape d'envoi. */
export const validateAttemptsAction = authActionClient
  .inputSchema(AttemptIdsSchema)
  .action(({ parsedInput: { accountId, ids }, ctx }) =>
    runBulk('validate', { ids, accountId, userId: ctx.user.id }),
  );

/** Passe des formulaires : pas d'envoi, préparation relançable plus tard. */
export const skipAttemptsAction = authActionClient
  .inputSchema(AttemptIdsSchema)
  .action(({ parsedInput: { accountId, ids }, ctx }) =>
    runBulk('skip', { ids, accountId, userId: ctx.user.id }),
  );

/** Ne jamais contacter : formulaire exclu et site en liste d'opposition. */
export const excludeAttemptsAction = authActionClient
  .inputSchema(AttemptIdsSchema)
  .action(({ parsedInput: { accountId, ids }, ctx }) =>
    runBulk('exclude', { ids, accountId, userId: ctx.user.id }),
  );

/** Enregistre objet, message et champs manquants d'un formulaire ; le valide si demandé. */
export const updateAttemptAction = authActionClient
  .inputSchema(UpdateAttemptSchema)
  .action(async ({ parsedInput, ctx }) => {
    const client = getSupabaseServerClient();

    const extra = Object.fromEntries(
      parsedInput.extraValues
        .filter((item) => item.value !== '')
        .map((item) => [item.label, item.value]),
    );

    const update = await client.rpc('lm_update_attempt', {
      p_id: parsedInput.id,
      p_subject: parsedInput.subject,
      p_body: parsedInput.body,
      p_extra: extra,
    });

    if (update.error) {
      await throwRpcError({
        scope: 'forms.update',
        error: update.error,
        hints: {},
        fallback: 'outreach.forms.actions.updateFailed',
        context: { accountId: parsedInput.accountId, userId: ctx.user.id },
      });
    }

    if (!update.data) {
      throw new Error('outreach.forms.actions.updateFailed');
    }

    let validated = 0;

    if (parsedInput.validate) {
      const result = await client.rpc('lm_validate_attempts', {
        p_ids: [parsedInput.id],
      });

      if (result.error) {
        throw new Error('outreach.forms.actions.failed');
      }

      validated = result.data ?? 0;

      if (validated === 0) {
        revalidateForms();
        throw new Error('outreach.forms.actions.validateIncomplete');
      }
    }

    revalidateForms();

    return { validated };
  });

/** Formulaires « à vérifier » : l'utilisateur confirme (envoyé) ou infirme (échec) l'envoi. */
export const markAttemptsAction = authActionClient
  .inputSchema(MarkAttemptsSchema)
  .action(async ({ parsedInput: { accountId, ids, outcome }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_mark_attempts', {
      p_ids: ids,
      p_outcome: outcome,
    });

    if (error) {
      await throwRpcError({
        scope: 'forms.mark',
        error,
        hints: {},
        fallback: 'outreach.forms.actions.failed',
        context: { accountId, userId: ctx.user.id },
      });
    }

    revalidateForms();

    return { count: data ?? 0 };
  });
