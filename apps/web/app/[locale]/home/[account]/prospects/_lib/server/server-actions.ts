'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  FIND_EMAILS_ERRORS,
  PREPARE_ERRORS,
  throwRpcError,
} from '~/lib/server/leadmaker/rpc-errors';

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

      await throwRpcError({
        scope: 'prospects.import',
        error,
        hints: {},
        fallback: 'campaigns.import.failed',
        context: { spaceId, userId: ctx.user.id },
      });
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
      await throwRpcError({
        scope: 'prospects.prepare',
        error,
        hints: PREPARE_ERRORS,
        fallback: 'outreach.forms.prepare.failed',
        context: { accountId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/forms', 'page');

    return { queued: data?.[0]?.queued ?? 0, skipped: data?.[0]?.skipped ?? 0 };
  });

/**
 * Recherche l'e-mail sur le site des prospects sélectionnés (sans préparer de
 * formulaire). Une tâche par prospect ; l'adresse apparaît dans la colonne E-mail.
 */
export const findEmailsAction = authActionClient
  .inputSchema(ProspectIdsSchema)
  .action(async ({ parsedInput: { accountId, ids }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_find_emails', { p_ids: ids });

    if (error) {
      await throwRpcError({
        scope: 'prospects.find-emails',
        error,
        hints: FIND_EMAILS_ERRORS,
        fallback: 'prospects.actions.findEmailsFailed',
        context: { accountId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/prospects', 'page');

    return { queued: data?.[0]?.queued ?? 0, skipped: data?.[0]?.skipped ?? 0 };
  });
