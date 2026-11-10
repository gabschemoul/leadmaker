/**
 * Packs de crédits (10/11/2026) : achat ponctuel en plus du forfait, valable 12 mois, utilisé seulement
 * quand les crédits du forfait sont épuisés (lm_debit_credits). Prix et identifiants Stripe dans
 * billing.config.ts : produit caché `credit-packs` en dollars et `credit-packs-eur` en euros (clients
 * européens). Ici, les crédits de chaque pack. Sert à la page Facturation (tuiles) et au webhook Stripe.
 */
import billingConfig from '~/config/billing.config';

import { currencyFor } from './billing-currency';

export type PackCurrency = 'USD' | 'EUR';

/** Produit des packs selon la devise. */
export const CREDIT_PACKS_PRODUCT_IDS: Record<PackCurrency, string> = {
  USD: 'credit-packs',
  EUR: 'credit-packs-eur',
};

export function isCreditPacksProduct(productId: string) {
  return Object.values(CREDIT_PACKS_PRODUCT_IDS).includes(productId);
}

/** Crédits donnés par chaque pack (id du plan sans le suffixe de devise). */
const PACK_CREDITS: Record<string, number> = {
  'pack-s': 3_000,
  'pack-m': 9_000,
  'pack-l': 18_000,
};

/** Id du pack sans devise (« pack-s-eur » → « pack-s ») : c'est lui qu'on enregistre en base. */
function basePackId(planId: string) {
  return planId.replace(/-eur$/, '');
}

const packProducts = billingConfig.products.filter((item) =>
  isCreditPacksProduct(item.id),
);

/** Tous les packs, dans les deux devises : id du plan et du pack, crédits, prix, devise, produit. */
export const CREDIT_PACKS = packProducts.flatMap((product) =>
  product.plans.flatMap((plan) => {
    const packId = basePackId(plan.id);
    const credits = PACK_CREDITS[packId];
    const lineItem = plan.lineItems[0];

    if (!credits || !lineItem) {
      return [];
    }

    return [
      {
        planId: plan.id,
        packId,
        productId: product.id,
        credits,
        price: lineItem.cost,
        currency: (product.currency ?? 'USD') as PackCurrency,
      },
    ];
  }),
);

export type CreditPack = (typeof CREDIT_PACKS)[number];

/** Les packs proposés dans une devise. */
export function creditPacksFor(currency: PackCurrency) {
  return CREDIT_PACKS.filter((pack) => pack.currency === currency);
}

/**
 * Pack correspondant à un prix Stripe (variant_id d'une commande), en euros ou en dollars, ou null si ce
 * n'est pas un pack. Côté serveur seulement : dans le navigateur, les identifiants de prix sont des valeurs
 * de substitution.
 */
export function findCreditPackByVariantId(variantId: string) {
  for (const product of packProducts) {
    for (const plan of product.plans) {
      if (plan.lineItems.some((item) => item.id === variantId)) {
        return CREDIT_PACKS.find((pack) => pack.planId === plan.id) ?? null;
      }
    }
  }

  return null;
}

/** Devise des packs pour un visiteur (même règle que les abonnements, billing-currency.ts). */
export function packCurrencyFor(params: {
  country: string | null;
  locale: string;
}): PackCurrency {
  return currencyFor(params);
}
