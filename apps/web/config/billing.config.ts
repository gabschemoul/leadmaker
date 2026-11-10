/**
 * Configuration de facturation Prospectigo.
 * Trois forfaits (Growth, Business, Scale), facturés en dollars américains,
 * mensuels ou annuels (annuel = 10 mois : deux mois offerts).
 * Crédit unique (9/11/2026) : 15 000 / 40 000 / 100 000 crédits par mois, 1 crédit = 1 entreprise
 * gardée, prise de contact incluse (les envois ne coûtent rien). Aucun plafond par jour.
 * Les textes (description, avantages, badge) sont des clés de traduction : billing.json › plans (FR/EN).
 * Packs de crédits (10/11/2026) : achat ponctuel réservé aux organisations avec forfait (S / M / L), produit
 * caché du choix de forfait et de la grille tarifaire ; crédits par pack dans lib/leadmaker/credit-packs.ts.
 * Les identifiants de prix Stripe sont lus dans l'environnement : tant qu'ils ne sont
 * pas renseignés, des valeurs de substitution permettent de faire tourner l'application.
 */
import {
  type BillingConfig,
  BillingProviderSchema,
  createBillingSchema,
} from '@kit/billing';

type Product = BillingConfig['products'][number];

const provider = BillingProviderSchema.parse(
  process.env.NEXT_PUBLIC_BILLING_PROVIDER,
);

const price = (envName: string, fallback: string) =>
  process.env[envName] || fallback;

/** Packs de crédits S / M / L dans une devise (ids de plan suffixés « -eur » pour l'euro). */
function creditPacksProduct(
  id: string,
  currency: 'USD' | 'EUR',
  envSuffix: string,
): Product {
  const planSuffix = envSuffix ? '-eur' : '';
  const packs = [
    { key: 'S', name: 'Pack S', cost: 99 },
    { key: 'M', name: 'Pack M', cost: 279 },
    { key: 'L', name: 'Pack L', cost: 549 },
  ];

  return {
    id,
    name: 'Packs de crédits',
    description: 'billing.creditPacks.description',
    currency,
    hidden: true,
    plans: packs.map((pack) => ({
      name: pack.name,
      id: `pack-${pack.key.toLowerCase()}${planSuffix}`,
      paymentType: 'one-time' as const,
      lineItems: [
        {
          id: price(
            `NEXT_PUBLIC_STRIPE_PRICE_PACK_${pack.key}${envSuffix}`,
            `price_pack_${pack.key.toLowerCase()}${planSuffix.replace('-', '_')}`,
          ),
          name: pack.name,
          cost: pack.cost,
          type: 'flat' as const,
        },
      ],
    })),
    features: ['billing.creditPacks.validity'],
  };
}

/** Les 3 abonnements en dollars (prix et textes) ; la version en euros est générée par inEuros(). */
const SUBSCRIPTIONS: Product[] = [
  {
    id: 'growth',
    name: 'Growth',
    description: 'billing.plans.growth.description',
    currency: 'USD',
    plans: [
      {
        name: 'Growth',
        id: 'growth-monthly',
        paymentType: 'recurring',
        interval: 'month',
        lineItems: [
          {
            id: price(
              'NEXT_PUBLIC_STRIPE_PRICE_GROWTH_MONTHLY',
              'price_growth_monthly',
            ),
            name: 'Growth',
            cost: 499,
            type: 'flat' as const,
          },
        ],
      },
      {
        name: 'Growth',
        id: 'growth-yearly',
        paymentType: 'recurring',
        interval: 'year',
        lineItems: [
          {
            id: price(
              'NEXT_PUBLIC_STRIPE_PRICE_GROWTH_YEARLY',
              'price_growth_yearly',
            ),
            name: 'Growth',
            cost: 4990,
            type: 'flat' as const,
          },
        ],
      },
    ],
    features: [
      'billing.plans.growth.features.discovery',
      'billing.plans.growth.features.outreach',
      'billing.plans.growth.features.seats',
      'billing.plans.growth.features.campaigns',
      'billing.plans.growth.features.support',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    badge: 'billing.plans.badgePopular',
    highlighted: true,
    description: 'billing.plans.business.description',
    currency: 'USD',
    plans: [
      {
        name: 'Business',
        id: 'business-monthly',
        paymentType: 'recurring',
        interval: 'month',
        lineItems: [
          {
            id: price(
              'NEXT_PUBLIC_STRIPE_PRICE_BUSINESS_MONTHLY',
              'price_business_monthly',
            ),
            name: 'Business',
            cost: 990,
            type: 'flat' as const,
          },
        ],
      },
      {
        name: 'Business',
        id: 'business-yearly',
        paymentType: 'recurring',
        interval: 'year',
        lineItems: [
          {
            id: price(
              'NEXT_PUBLIC_STRIPE_PRICE_BUSINESS_YEARLY',
              'price_business_yearly',
            ),
            name: 'Business',
            cost: 9900,
            type: 'flat' as const,
          },
        ],
      },
    ],
    features: [
      'billing.plans.business.features.discovery',
      'billing.plans.business.features.outreach',
      'billing.plans.business.features.seats',
      'billing.plans.business.features.campaigns',
      'billing.plans.business.features.support',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    description: 'billing.plans.scale.description',
    currency: 'USD',
    plans: [
      {
        name: 'Scale',
        id: 'scale-monthly',
        paymentType: 'recurring',
        interval: 'month',
        lineItems: [
          {
            id: price(
              'NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY',
              'price_scale_monthly',
            ),
            name: 'Scale',
            cost: 1999,
            type: 'flat' as const,
          },
        ],
      },
      {
        name: 'Scale',
        id: 'scale-yearly',
        paymentType: 'recurring',
        interval: 'year',
        lineItems: [
          {
            id: price(
              'NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY',
              'price_scale_yearly',
            ),
            name: 'Scale',
            cost: 19990,
            type: 'flat' as const,
          },
        ],
      },
    ],
    features: [
      'billing.plans.scale.features.discovery',
      'billing.plans.scale.features.outreach',
      'billing.plans.scale.features.seats',
      'billing.plans.scale.features.campaigns',
      'billing.plans.scale.features.support',
    ],
  },
];

/**
 * Version en euros d'un abonnement (10/11/2026 : euros pour les clients européens, mêmes montants) : ids
 * suffixés « -eur », prix Stripe lus dans NEXT_PUBLIC_STRIPE_PRICE_<FORFAIT>_<MONTHLY|YEARLY>_EUR. Cachée par
 * défaut ; lib/leadmaker/billing-currency.ts choisit la devise affichée.
 */
function inEuros(product: Product): Product {
  return {
    ...product,
    id: `${product.id}-eur`,
    currency: 'EUR',
    hidden: true,
    plans: product.plans.map((plan) => ({
      ...plan,
      id: `${plan.id}-eur`,
      lineItems: plan.lineItems.map((item) => ({
        ...item,
        id: price(
          `NEXT_PUBLIC_STRIPE_PRICE_${product.id.toUpperCase()}_${plan.interval === 'year' ? 'YEARLY' : 'MONTHLY'}_EUR`,
          `${item.id}_eur`,
        ),
      })),
    })),
  };
}

export default createBillingSchema({
  provider,
  products: [
    ...SUBSCRIPTIONS,
    ...SUBSCRIPTIONS.map(inEuros),
    // Packs de crédits : paiement unique, achetés depuis la page Facturation (jamais dans le choix de forfait).
    // Deux produits : en euros pour les clients européens, en dollars pour les autres (choix de Gabriel, 10/11).
    creditPacksProduct('credit-packs', 'USD', ''),
    creditPacksProduct('credit-packs-eur', 'EUR', '_EUR'),
  ],
});
