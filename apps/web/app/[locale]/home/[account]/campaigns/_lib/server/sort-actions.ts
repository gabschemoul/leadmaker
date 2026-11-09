'use server';

/**
 * Rôle : actions de l'écran « Vos entreprises » (CDC-PARCOURS-TRI-ANNUAIRE §6) : garder ou écarter des
 * entreprises « À vérifier ».
 * Données : fonction SQL lm_choose_prospects (contrôle d'accès lm_member en base).
 * Écritures : lm_campaign_prospects.client_choice ; une entreprise gardée est payée au prix de la campagne.
 */
import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CHOOSE_PROSPECTS_ERRORS,
  throwRpcError,
} from '~/lib/server/leadmaker/rpc-errors';

import { ChooseProspectsSchema } from '../schema/campaign.schema';

export const chooseProspectsAction = authActionClient
  .inputSchema(ChooseProspectsSchema)
  .action(async ({ parsedInput: { campaignId, prospectIds, choice }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_choose_prospects', {
      p_campaign_id: campaignId,
      p_prospect_ids: prospectIds,
      p_choice: choice,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.chooseProspects',
        error,
        hints: CHOOSE_PROSPECTS_ERRORS,
        fallback: 'campaigns.companies.chooseFailed',
        context: { campaignId, choice, userId: ctx.user.id },
      });
    }

    // pas de revalidatePath : l'écran relit ses listes dans le navigateur (React Query), sans recharger la page
    return { count: data ?? 0, choice };
  });
