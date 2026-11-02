/**
 * Configuration de facturation Prospectigo.
 * Trois forfaits (Growth, Business, Scale), facturés en dollars américains,
 * mensuels ou annuels (annuel = 10 mois : deux mois offerts).
 * Volumes décidés le 2/11/2026 : 30 000 / 80 000 / 200 000 crédits de prospection
 * et 15 000 / 40 000 / 100 000 prises de contact par mois. Aucun plafond par jour.
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
      currency: 'USD',
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
        '30 000 crédits de prospection par mois',
        '15 000 prises de contact par mois',
        '1 siège',
        '1 campagne active',
        'Support et onboarding',
      ],
    },
    {
      id: 'business',
      name: 'Business',
      badge: 'Populaire',
      highlighted: true,
      description: "L'offre principale pour les agences",
      currency: 'USD',
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
              cost: 990,
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
              cost: 9900,
              type: 'flat' as const,
            },
          ],
        },
      ],
      features: [
        '80 000 crédits de prospection par mois',
        '40 000 prises de contact par mois',
        '3 sièges',
        '3 campagnes actives',
        'Support et onboarding',
      ],
    },
    {
      id: 'scale',
      name: 'Scale',
      description: 'Pour les agences et réseaux à fort volume',
      currency: 'USD',
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
        '200 000 crédits de prospection par mois',
        '100 000 prises de contact par mois',
        '6 sièges',
        '10 campagnes actives',
        'Support prioritaire et onboarding',
      ],
    },
  ],
});
