'use server';

import { revalidatePath } from 'next/cache';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ImportProspectsSchema } from '../schema/import.schema';

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
        throw new Error('campaigns.import.spaceNotFound');
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
