'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ImportProspectsSchema } from '../schema/import.schema';
import {
  PrepareProspectsSchema,
  ProspectIdsSchema,
} from '../schema/prospects-actions.schema';
import { createProspectsService } from './prospects.service';

/**
 * Importe un paquet de prospects (2 000 lignes au plus) dans un espace.
 * Sans crédit ; les sites déjà présents dans l'espace sont ignorés.
 */
export const importProspectsAction = authActionClient
  .inputSchema(ImportProspectsSchema)
  .action(async ({ parsedInput: { spaceId, rows }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_import_prospects', {
      p_space_id: spaceId,
      p_rows: rows,
    });

    if (error) {
      if (error.code === 'P0002') {
        throw new Error('campaigns.import.folderNotFound');
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.prospects.import',
          spaceId,
          userId: ctx.user.id,
          error,
        },
        'Prospect import failed',
      );

      throw new Error('campaigns.import.failed');
    }

    revalidatePath('/home/[account]/prospects', 'page');

    return {
      inserted: data?.[0]?.inserted ?? 0,
      duplicates: data?.[0]?.duplicates ?? 0,
    };
  });

/**
 * Chemins à rafraîchir après une action groupée : la liste des prospects et
 * le détail des campagnes (qui montre les derniers prospects).
 */
function revalidateProspects() {
  revalidatePath('/home/[account]/prospects', 'page');
  revalidatePath('/home/[account]/campaigns/[id]', 'page');
}

/** Exclut des prospects : ils ne seront jamais contactés (réversible). */
export const excludeProspectsAction = authActionClient
  .inputSchema(ProspectIdsSchema)
  .action(async ({ parsedInput: { accountId, ids }, ctx }) => {
    const service = createProspectsService(getSupabaseServerClient());
    const result = await service.exclude({
      ids,
      accountId,
      userId: ctx.user.id,
    });

    revalidateProspects();

    return result;
  });

/** Rétablit des prospects exclus. */
export const restoreProspectsAction = authActionClient
  .inputSchema(ProspectIdsSchema)
  .action(async ({ parsedInput: { accountId, ids }, ctx }) => {
    const service = createProspectsService(getSupabaseServerClient());
    const result = await service.restore({
      ids,
      accountId,
      userId: ctx.user.id,
    });

    revalidateProspects();

    return result;
  });

/**
 * Supprime définitivement des prospects. La fonction SQL n'efface que si le
 * membre a la permission `settings.manage` ; sinon elle renvoie 0.
 */
export const deleteProspectsAction = authActionClient
  .inputSchema(ProspectIdsSchema)
  .action(async ({ parsedInput: { accountId, ids }, ctx }) => {
    const service = createProspectsService(getSupabaseServerClient());
    const result = await service.delete({
      ids,
      accountId,
      userId: ctx.user.id,
    });

    revalidateProspects();

    return result;
  });

const PREPARE_ERRORS: Record<string, string> = {
  no_sender: 'outreach.forms.prepare.noSender',
  no_messages: 'outreach.forms.prepare.noMessages',
  cap_reached: 'outreach.forms.prepare.capReached',
};

/**
 * Met des prospects en file de préparation : le robot remplira leur formulaire
 * de contact sans l'envoyer. Renvoie le nombre mis en file et le nombre ignorés
 * (sans site, exclus, déjà traités).
 */
export const prepareProspectsAction = authActionClient
  .inputSchema(PrepareProspectsSchema)
  .action(async ({ parsedInput: { accountId, ids, campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_prepare_prospects', {
      p_ids: ids,
      p_campaign_id: campaignId ?? undefined,
    });

    if (error) {
      const known = error.hint ? PREPARE_ERRORS[error.hint] : undefined;

      if (known) {
        throw new Error(known);
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.prospects.prepare',
          accountId,
          userId: ctx.user.id,
          error,
        },
        'Failed to queue form preparation',
      );

      throw new Error('outreach.forms.prepare.failed');
    }

    revalidatePath('/home/[account]/forms', 'page');

    return { queued: data?.[0]?.queued ?? 0, skipped: data?.[0]?.skipped ?? 0 };
  });
