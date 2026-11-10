import 'server-only';
import { cache } from 'react';

import { connection } from 'next/server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';

import { findCreditPackByVariantId } from '~/lib/leadmaker/credit-packs';

/**
 * @name loadTeamAccountBillingPage
 * @description Load the team account billing page data for the given account.
 */
export const loadTeamAccountBillingPage = cache(teamAccountBillingPageLoader);

async function teamAccountBillingPageLoader(accountId: string) {
  await connection();

  const client = getSupabaseServerClient();
  const api = createTeamAccountsApi(client);

  const subscription = api.getSubscription(accountId);
  const order = loadPlanOrder(client, accountId);
  const customerId = api.getCustomerId(accountId);

  return Promise.all([subscription, order, customerId]);
}

/**
 * Commande d'une offre à paiement unique, hors packs de crédits (10/11/2026) : les achats de packs sont
 * aussi des commandes, mais ils ne remplacent pas le forfait et une organisation peut en avoir plusieurs
 * (api.getOrder n'en accepte qu'une).
 */
async function loadPlanOrder(
  client: SupabaseClient<Database>,
  accountId: string,
) {
  const { data, error } = await client
    .from('orders')
    .select('*, items: order_items !inner (*)')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (
    (data ?? []).find(
      (order) =>
        !order.items.some((item) => findCreditPackByVariantId(item.variant_id)),
    ) ?? null
  );
}
