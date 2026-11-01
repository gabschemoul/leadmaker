/**
 * Configuration de facturation LeadMaker.
 * Trois forfaits (Growth, Business, Scale), mensuels ou annuels (deux mois offerts).
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
      description: 'Pour une PME qui prospecte pour elle-même',
      currency: 'EUR',
      plans: [
        {
          name: 'Growth mensuel',
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
          name: 'Growth annuel',
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
        '15 000 prospects par mois',
        '5 000 prises de contact par mois',
        '3 espaces, 2 sièges',
        '1 campagne active',
        'Support email',
      ],
    },
    {
      id: 'business',
      name: 'Business',
      badge: 'Populaire',
      highlighted: true,
      description: "L'offre principale pour les agences",
      currency: 'EUR',
      plans: [
        {
          name: 'Business mensuel',
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
              cost: 999,
              type: 'flat' as const,
            },
          ],
        },
        {
          name: 'Business annuel',
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
              cost: 9990,
              type: 'flat' as const,
            },
          ],
        },
      ],
      features: [
        '45 000 prospects par mois',
        '15 000 prises de contact par mois',
        '5 espaces, 5 sièges',
        '3 campagnes actives',
        'Auto-validation (activation explicite)',
        'Support email prioritaire',
      ],
    },
    {
      id: 'scale',
      name: 'Scale',
      description: 'Pour les agences et réseaux à fort volume',
      currency: 'EUR',
      plans: [
        {
          name: 'Scale mensuel',
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
          name: 'Scale annuel',
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
        '105 000 prospects par mois',
        '35 000 prises de contact par mois',
        '10 espaces, sièges illimités',
        'Campagnes illimitées',
        'Auto-validation (activation explicite)',
        'Support prioritaire et onboarding dédié',
      ],
    },
  ],
});
