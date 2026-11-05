'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { throwRpcError } from '~/lib/server/leadmaker/rpc-errors';

import {
  CreateSpaceSchema,
  DeleteSpaceSchema,
  RenameSpaceSchema,
} from '../schema/space.schema';

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

function revalidateSpaces() {
  revalidatePath('/home/[account]', 'layout');
}

/** Renomme un dossier client (le nom reste unique dans l'organisation). */
export const renameSpaceAction = authActionClient
  .inputSchema(RenameSpaceSchema)
  .action(async ({ parsedInput: { accountId, spaceId, name }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('lm_spaces')
      .update({ name })
      .eq('id', spaceId)
      .eq('account_id', accountId)
      .select('id');

    if (error) {
      if (error.code === '23505') {
        throw new Error('campaigns.folders.nameTaken');
      }

      await throwRpcError({
        scope: 'spaces.rename',
        error,
        hints: {},
        fallback: 'campaigns.folders.renameError',
        context: { accountId, spaceId, userId: ctx.user.id },
      });
    }

    if (!data?.length) {
      throw new Error('campaigns.folders.renameError');
    }

    revalidateSpaces();

    return { success: true };
  });

/**
 * Supprime un dossier client et TOUT son contenu (campagnes, prospects, formulaires, liste d'opposition).
 * Refusé pour le dossier par défaut (politique RLS) et tant qu'une campagne du dossier tourne : la recherche
 * en cours enverrait sinon des résultats vers un dossier disparu. Réservé aux rôles « settings.manage ».
 */
export const deleteSpaceAction = authActionClient
  .inputSchema(DeleteSpaceSchema)
  .action(async ({ parsedInput: { accountId, spaceId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { count: running } = await client
      .from('lm_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('status', 'running');

    if ((running ?? 0) > 0) {
      throw new Error('campaigns.folders.deleteRunning');
    }

    const { data, error } = await client
      .from('lm_spaces')
      .delete()
      .eq('id', spaceId)
      .eq('account_id', accountId)
      .select('id');

    if (error) {
      await throwRpcError({
        scope: 'spaces.delete',
        error,
        hints: {},
        fallback: 'campaigns.folders.deleteError',
        context: { accountId, spaceId, userId: ctx.user.id },
      });
    }

    // rien de supprimé : dossier par défaut, ou droits insuffisants (politique RLS)
    if (!data?.length) {
      throw new Error('campaigns.folders.deleteForbidden');
    }

    revalidateSpaces();

    return { success: true };
  });
