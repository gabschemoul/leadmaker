import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { UpsertSubscriptionParams } from '@kit/billing/types';
import type { Database } from '@kit/supabase/database';

import billingConfig from '~/config/billing.config';

type Client = SupabaseClient<Database>;

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Retrouve le forfait LeadMaker (id du produit dans billing.config : growth,
 * business, scale) à partir des prix d'un abonnement.
 */
export function findPlanId(variantIds: string[]) {
  for (const product of billingConfig.products) {
    for (const plan of product.plans) {
      if (plan.lineItems.some((item) => variantIds.includes(item.id))) {
        return product.id;
      }
    }
  }

  return null;
}

/**
 * Crédite une organisation des quotas de son forfait pour la période en cours.
 * Idempotent : un même abonnement, une même période et un même forfait ne
 * créditent qu'une fois, quel que soit le nombre de webhooks reçus.
 */
export function createPlanCreditsService(client: Client) {
  return {
    async syncFromSubscription(subscription: UpsertSubscriptionParams) {
      if (!subscription.active || !ACTIVE_STATUSES.has(subscription.status)) {
        return { credited: false, reason: 'inactive' as const };
      }

      const lineItems = Array.isArray(subscription.line_items)
        ? subscription.line_items
        : [];

      const planId = findPlanId(lineItems.map((item) => item.variant_id));

      if (!planId) {
        return { credited: false, reason: 'unknown-plan' as const };
      }

      const eventRef = [
        'subscription',
        subscription.target_subscription_id,
        subscription.period_starts_at,
        planId,
      ].join(':');

      const { error } = await client.rpc('lm_reset_credits', {
        p_account_id: subscription.target_account_id,
        p_plan_id: planId,
        p_period_ends_at: subscription.period_ends_at,
        p_event_ref: eventRef,
      });

      if (error) {
        throw error;
      }

      return { credited: true, planId };
    },
  };
}
