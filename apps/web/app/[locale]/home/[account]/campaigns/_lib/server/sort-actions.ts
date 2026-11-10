'use server';

/**
 * Rôle : actions de l'écran « Vos entreprises » (CDC-PARCOURS-TRI-ANNUAIRE §6) : garder ou écarter des
 * entreprises « À vérifier » ; encart des groupes (§4.3) : « Un message par groupe » / « Un seul message » /
 * « Changer » ; « Créer N campagnes » (ancien choix, plus proposé par l'écran depuis le 10/11).
 * Données : fonctions SQL lm_choose_prospects, lm_set_groups_choice, lm_split_campaign_by_groups (contrôle d'accès
 * lm_member en base).
 * Écritures : lm_campaign_prospects.client_choice (une entreprise gardée est payée au prix de la campagne) ;
 * lm_campaigns.groups_choice ; une campagne en brouillon par groupe (sans recherche ni débit).
 */
import { authActionClient } from '@kit/next/safe-action';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CHOOSE_PROSPECTS_ERRORS,
  GROUPS_ERRORS,
  throwRpcError,
} from '~/lib/server/leadmaker/rpc-errors';

import {
  CampaignIdSchema,
  ChooseProspectsSchema,
  SetGroupsChoiceSchema,
} from '../schema/campaign.schema';

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

/**
 * « Un message par groupe » dans cette même campagne ('per_group'), « Un seul message » pour tous les groupes
 * ('single'), ou « Changer » (null) : l'encart des groupes revient.
 */
export const setGroupsChoiceAction = authActionClient
  .inputSchema(SetGroupsChoiceSchema)
  .action(async ({ parsedInput: { campaignId, choice }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_set_groups_choice', {
      p_campaign_id: campaignId,
      // le type généré n'accepte pas null, la fonction SQL si (« Changer »)
      p_choice: choice as string,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.setGroupsChoice',
        error,
        hints: GROUPS_ERRORS,
        fallback: 'campaigns.companies.groups.choiceFailed',
        context: { campaignId, choice, userId: ctx.user.id },
      });
    }

    return { choice };
  });

/**
 * « Créer N campagnes » : une campagne en brouillon par groupe, avec les entreprises gardées de ce groupe (sans
 * nouvelle recherche ni débit). Une seule fois par campagne. Renvoie les campagnes créées.
 */
export const splitCampaignByGroupsAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_split_campaign_by_groups', {
      p_campaign_id: campaignId,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.splitByGroups',
        error,
        hints: GROUPS_ERRORS,
        fallback: 'campaigns.companies.groups.splitFailed',
        context: { campaignId, userId: ctx.user.id },
      });
    }

    return {
      campaigns: (data ?? []).map((row) => ({
        id: row.campaign_id,
        label: row.label || row.group_key,
        companies: row.companies ?? 0,
      })),
    };
  });
