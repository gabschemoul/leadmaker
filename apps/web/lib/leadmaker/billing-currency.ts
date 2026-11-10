/**
 * Devise affichée (10/11/2026, choix de Gabriel) : euros pour les clients européens, dollars pour les autres,
 * pour les abonnements comme pour les packs de crédits. Les deux versions existent dans billing.config.ts
 * (produits suffixés « -eur ») ; on montre l'une et on cache l'autre.
 */
import type { BillingConfig } from '@kit/billing';

import billingConfig from '~/config/billing.config';

export type BillingCurrency = 'USD' | 'EUR';

/** Pays européens (UE, EEE, Suisse, Royaume-Uni et micro-États). */
const EUROPE = new Set(
  (
    'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE ' +
    'IS LI NO CH GB MC SM VA AD ME AL BA MK RS MD UA'
  ).split(' '),
);

/**
 * Devise d'un visiteur : euros s'il est en Europe (pays donné par Vercel, en-tête x-vercel-ip-country),
 * sinon dollars ; sans pays connu (page préparée à l'avance, ou en local), euros si l'appli est en français.
 */
export function currencyFor(params: {
  country?: string | null;
  locale: string;
}): BillingCurrency {
  if (params.country) {
    return EUROPE.has(params.country.toUpperCase()) ? 'EUR' : 'USD';
  }

  return params.locale.startsWith('fr') ? 'EUR' : 'USD';
}

/** Abonnement ou pack en euros (id suffixé « -eur ») ? */
export function isEuroProduct(productId: string) {
  return productId.endsWith('-eur');
}

/**
 * Configuration montrée au client : abonnements de sa devise visibles, ceux de l'autre devise cachés (le
 * choix de forfait et la grille tarifaire ignorent les produits cachés). Les packs restent cachés : ils ont
 * leur propre carte. Le paiement relit la configuration complète côté serveur.
 */
export function billingConfigFor(currency: BillingCurrency): BillingConfig {
  return {
    ...billingConfig,
    products: billingConfig.products.map((product) => {
      const recurring = product.plans.some(
        (plan) => plan.paymentType === 'recurring',
      );

      if (!recurring) {
        return product;
      }

      return {
        ...product,
        hidden: isEuroProduct(product.id) !== (currency === 'EUR'),
      };
    }),
  };
}
