import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';
import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

type BulkOperation = 'exclude' | 'restore' | 'delete';

const RPC_BY_OPERATION = {
  exclude: 'lm_exclude_prospects',
  restore: 'lm_restore_prospects',
  delete: 'lm_delete_prospects',
} as const;

export function createProspectsService(client: Client) {
  return new ProspectsService(client);
}

/**
 * Actions groupées sur des prospects. Chaque fonction SQL ne touche que les
 * lignes de l'organisation du membre (et, pour la suppression, seulement si le
 * membre a la permission `settings.manage`) et renvoie le nombre de lignes
 * traitées.
 */
class ProspectsService {
  constructor(private readonly client: Client) {}

  /** Exclure : ces entreprises ne seront jamais contactées (réversible). */
  exclude(params: { ids: string[]; accountId: string; userId: string }) {
    return this.run('exclude', params);
  }

  /** Rétablir des prospects exclus. */
  restore(params: { ids: string[]; accountId: string; userId: string }) {
    return this.run('restore', params);
  }

  /** Supprimer définitivement (permission `settings.manage`). */
  delete(params: { ids: string[]; accountId: string; userId: string }) {
    return this.run('delete', params);
  }

  private async run(
    operation: BulkOperation,
    params: { ids: string[]; accountId: string; userId: string },
  ) {
    const { data, error } = await this.client.rpc(RPC_BY_OPERATION[operation], {
      p_ids: params.ids,
    });

    if (error) {
      const logger = await getLogger();

      logger.error(
        {
          name: `leadmaker.prospects.${operation}`,
          accountId: params.accountId,
          userId: params.userId,
          count: params.ids.length,
          error,
        },
        `Prospect bulk ${operation} failed`,
      );

      throw new Error(`prospects.actions.${operation}Failed`);
    }

    return { count: data ?? 0 };
  }
}
