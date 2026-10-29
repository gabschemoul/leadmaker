import { getPlanTypesMap } from '@kit/billing';
import { getBillingEventHandlerService } from '@kit/billing-gateway';
import type { UpsertSubscriptionParams } from '@kit/billing/types';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import billingConfig from '~/config/billing.config';
import { createPlanCreditsService } from '~/lib/server/leadmaker/plan-credits.service';

/**
 * @description Handle the webhooks from Stripe related to checkouts
 */
export const POST = enhanceRouteHandler(
  async ({ request }) => {
    const provider = billingConfig.provider;
    const logger = await getLogger();

    const ctx = {
      name: 'billing.webhook',
      provider,
    };

    logger.info(ctx, `Received billing webhook. Processing...`);

    const supabaseClientProvider = () => getSupabaseServerAdminClient();

    const service = await getBillingEventHandlerService(
      supabaseClientProvider,
      provider,
      getPlanTypesMap(billingConfig),
    );

    // Crédits LeadMaker : à chaque abonnement payé ou renouvelé, l'organisation
    // reçoit les quotas de son forfait (idempotent par abonnement et période).
    const credits = createPlanCreditsService(supabaseClientProvider());

    const syncCredits = async (subscription: UpsertSubscriptionParams) => {
      const result = await credits.syncFromSubscription(subscription);

      logger.info(
        {
          ...ctx,
          accountId: subscription.target_account_id,
          subscriptionId: subscription.target_subscription_id,
          ...result,
        },
        'LeadMaker credits sync',
      );
    };

    try {
      await service.handleWebhookEvent(request, {
        onCheckoutSessionCompleted: async (payload) => {
          if (!('target_order_id' in payload)) {
            await syncCredits(payload);
          }
        },
        onSubscriptionUpdated: syncCredits,
        onInvoicePaid: syncCredits,
      });

      logger.info(ctx, `Successfully processed billing webhook`);

      return new Response('OK', { status: 200 });
    } catch (error) {
      logger.error({ ...ctx, error }, `Failed to process billing webhook`);

      return new Response('Failed to process billing webhook', {
        status: 500,
      });
    }
  },
  {
    auth: false,
  },
);
