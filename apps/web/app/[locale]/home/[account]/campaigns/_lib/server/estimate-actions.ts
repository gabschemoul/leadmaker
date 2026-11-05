'use server';

/**
 * Rôle : actions serveur d'estimation d'une campagne avant lancement (calcul rapide et mesure réelle).
 * Données : fonctions SQL lm_estimate_campaign et lm_request_estimate.
 * Écritures : lm_request_estimate crée une estimation et sa tâche pour les robots (sans crédit).
 */
import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  ESTIMATE_ERRORS,
  throwRpcError,
} from '~/lib/server/leadmaker/rpc-errors';

import {
  EstimateCampaignSchema,
  RequestEstimateSchema,
} from '../schema/campaign.schema';

/** Estimation avant lancement : villes, recherches et prospects attendus. */
export const estimateCampaignAction = authActionClient
  .inputSchema(EstimateCampaignSchema)
  .action(async ({ parsedInput: { countryCode, targeting, filters } }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_estimate_campaign', {
      p_country_code: countryCode,
      p_targeting: targeting,
      p_filters: filters ?? {},
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.estimate',
        error,
        hints: {},
        fallback: 'campaigns.errors.estimateFailed',
      });
    }

    const row = data?.[0];

    return {
      cities: row?.cities ?? 0,
      categories: row?.categories ?? 0,
      searches: row?.searches ?? 0,
      expectedProspects: row?.expected_prospects ?? 0,
    };
  });

/**
 * Estimation réelle : le worker lit Google Maps (sans ouvrir les fiches, sans crédit)
 * et compte les entreprises qui passent les filtres. Renvoie l'identifiant à suivre.
 */
export const requestEstimateAction = authActionClient
  .inputSchema(RequestEstimateSchema)
  .action(
    async ({ parsedInput: { accountId, countryCode, targeting, filters } }) => {
      const client = getSupabaseServerClient();

      const { data, error } = await client.rpc('lm_request_estimate', {
        p_account_id: accountId,
        p_country_code: countryCode,
        p_targeting: targeting,
        p_filters: filters,
      });

      if (error) {
        await throwRpcError({
          scope: 'campaigns.real-estimate',
          error,
          hints: ESTIMATE_ERRORS,
          fallback: 'campaigns.errors.estimateFailed',
          context: { accountId },
        });
      }

      if (!data) {
        throw new Error('campaigns.errors.estimateFailed');
      }

      return { estimateId: data };
    },
  );
