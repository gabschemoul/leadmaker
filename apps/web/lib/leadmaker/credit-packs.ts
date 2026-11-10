/**
 * Packs de crédits (10/11/2026) : achat ponctuel en plus du forfait, valable 12 mois, utilisé seulement
 * quand les crédits du forfait sont épuisés (lm_debit_credits). Prix et identifiants Stripe dans
 * billing.config.ts (produit caché `credit-packs`) ; ici, les crédits de chaque pack.
 * Sert à la page Facturation (tuiles) et au webhook Stripe (crédit du pack payé).
 */
import billingConfig from '~/config/billing.config';

export const CREDIT_PACKS_PRODUCT_ID = 'credit-packs';

/** Crédits donnés par chaque pack (id du plan dans billing.config.ts). */
const PACK_CREDITS: Record<string, number> = {
  'pack-s': 3_000,
  'pack-m': 9_000,
  'pack-l': 18_000,
};

const product = billingConfig.products.find(
  (item) => item.id === CREDIT_PACKS_PRODUCT_ID,
);

/** Les packs dans l'ordre de billing.config.ts : id du plan, crédits, prix, devise. */
export const CREDIT_PACKS = (product?.plans ?? []).flatMap((plan) => {
  const credits = PACK_CREDITS[plan.id];
  const lineItem = plan.lineItems[0];

  if (!credits || !lineItem) {
    return [];
  }

  return [
    {
      planId: plan.id,
      credits,
      price: lineItem.cost,
      currency: product?.currency ?? 'USD',
    },
  ];
});

export type CreditPack = (typeof CREDIT_PACKS)[number];

/**
 * Pack correspondant à un prix Stripe (variant_id d'une commande), ou null si ce n'est pas un pack.
 * Côté serveur seulement : dans le navigateur, les identifiants de prix sont des valeurs de substitution.
 */
export function findCreditPackByVariantId(variantId: string) {
  for (const plan of product?.plans ?? []) {
    if (plan.lineItems.some((item) => item.id === variantId)) {
      return CREDIT_PACKS.find((pack) => pack.planId === plan.id) ?? null;
    }
  }

  return null;
}
