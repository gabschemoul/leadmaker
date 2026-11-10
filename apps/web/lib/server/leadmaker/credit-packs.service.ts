import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { UpsertOrderParams } from '@kit/billing/types';
import type { Database } from '@kit/supabase/database';

import { findCreditPackByVariantId } from '~/lib/leadmaker/credit-packs';

type Client = SupabaseClient<Database>;

type OrderLine = { variant_id: string; quantity: number };

/**
 * Packs de crédits (10/11/2026) : crédite une organisation des packs payés dans une commande Stripe.
 * Idempotent : une commande et un prix ne créditent qu'une fois (order_ref = « commande:prix »), quel que
 * soit le nombre de webhooks reçus. Une commande sans pack est simplement ignorée.
 * Client administrateur (lm_grant_credit_pack est réservée au service).
 */
export function createCreditPacksService(client: Client) {
  const grant = async (params: {
    accountId: string;
    orderId: string;
    lines: OrderLine[];
  }) => {
    const granted: Array<{ packId: string; credits: number; added: boolean }> =
      [];

    for (const line of params.lines) {
      const pack = findCreditPackByVariantId(line.variant_id);

      if (!pack) continue;

      const credits = pack.credits * Math.max(1, line.quantity);

      const { data, error } = await client.rpc('lm_grant_credit_pack', {
        p_account_id: params.accountId,
        p_pack_id: pack.planId,
        p_credits: credits,
        p_order_ref: `${params.orderId}:${line.variant_id}`,
      });

      // erreur : on la remonte, Stripe renverra l'événement (sans risque de double crédit)
      if (error) {
        throw error;
      }

      granted.push({ packId: pack.planId, credits, added: data === true });
    }

    return granted;
  };

  return {
    /** Paiement terminé au retour du paiement (carte) : la commande arrive complète dans l'événement. */
    async grantFromOrder(order: UpsertOrderParams) {
      if (order.status !== 'succeeded') {
        return { granted: [], reason: 'not-paid' as const };
      }

      const granted = await grant({
        accountId: order.target_account_id,
        orderId: order.target_order_id,
        lines: parseLines(order.line_items),
      });

      return { granted };
    },

    /**
     * Paiement différé (ex. prélèvement) validé plus tard : Stripe ne donne que l'id de la session ;
     * la commande et ses lignes ont été enregistrées au moment du paiement (upsert_order).
     */
    async grantFromStoredOrder(orderId: string) {
      const { data: order, error } = await client
        .from('orders')
        .select(
          'id, account_id, status, items:order_items(variant_id, quantity)',
        )
        .eq('id', orderId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!order) {
        return { granted: [], reason: 'unknown-order' as const };
      }

      if (order.status !== 'succeeded') {
        return { granted: [], reason: 'not-paid' as const };
      }

      const granted = await grant({
        accountId: order.account_id,
        orderId: order.id,
        lines: order.items ?? [],
      });

      return { granted };
    },
  };
}

/** Lignes d'une commande Stripe (champ JSON de upsert_order) : prix et quantité. */
function parseLines(value: unknown): OrderLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const { variant_id, quantity } = item as Record<string, unknown>;

    if (typeof variant_id !== 'string') return [];

    return [
      {
        variant_id,
        quantity: typeof quantity === 'number' ? quantity : 1,
      },
    ];
  });
}
