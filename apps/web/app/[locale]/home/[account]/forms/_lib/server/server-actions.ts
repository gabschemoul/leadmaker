'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AttemptIdsSchema,
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
    const logger = await getLogger();
    logger.error(
      {
        name: `leadmaker.forms.${operation}`,
        accountId: params.accountId,
        userId: params.userId,
        error,
      },
      'Bulk attempt action failed',
    );

    throw new Error('outreach.forms.actions.failed');
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

    if (update.error || !update.data) {
      if (update.error) {
        const logger = await getLogger();
        logger.error(
          {
            name: 'leadmaker.forms.update',
            accountId: parsedInput.accountId,
            userId: ctx.user.id,
            error: update.error,
          },
          'Attempt update failed',
        );
      }

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
