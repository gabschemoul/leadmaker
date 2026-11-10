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
import { BillingProviderSchema, createBillingSchema } from '@kit/billing';

const provider = BillingProviderSchema.parse(
  process.env.NEXT_PUBLIC_BILLING_PROVIDER,
);

const price = (envName: string, fallback: string) =>
  process.env[envName] || fallback;

export default createBillingSchema({
  provider,
  products: [
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
    {
      // Packs de crédits : paiement unique, achetés depuis la page Facturation (jamais dans le choix de forfait)
      id: 'credit-packs',
      name: 'Packs de crédits',
      description: 'billing.creditPacks.description',
      currency: 'USD',
      hidden: true,
      plans: [
        {
          name: 'Pack S',
          id: 'pack-s',
          paymentType: 'one-time',
          lineItems: [
            {
              id: price('NEXT_PUBLIC_STRIPE_PRICE_PACK_S', 'price_pack_s'),
              name: 'Pack S',
              cost: 99,
              type: 'flat' as const,
            },
          ],
        },
        {
          name: 'Pack M',
          id: 'pack-m',
          paymentType: 'one-time',
          lineItems: [
            {
              id: price('NEXT_PUBLIC_STRIPE_PRICE_PACK_M', 'price_pack_m'),
              name: 'Pack M',
              cost: 279,
              type: 'flat' as const,
            },
          ],
        },
        {
          name: 'Pack L',
          id: 'pack-l',
          paymentType: 'one-time',
          lineItems: [
            {
              id: price('NEXT_PUBLIC_STRIPE_PRICE_PACK_L', 'price_pack_l'),
              name: 'Pack L',
              cost: 549,
              type: 'flat' as const,
            },
          ],
        },
      ],
      features: ['billing.creditPacks.validity'],
    },
  ],
});
