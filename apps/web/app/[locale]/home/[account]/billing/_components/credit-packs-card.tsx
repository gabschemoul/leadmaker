import { getFormatter, getTranslations } from 'next-intl/server';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

import { CREDIT_PACKS } from '~/lib/leadmaker/credit-packs';

import { CreditPacksPicker } from './credit-packs-picker';

/**
 * Carte « Acheter des crédits » (packs de crédits, 10/11/2026) sur la page Facturation : affichée seulement
 * quand l'organisation a un abonnement en cours et que l'utilisateur peut gérer la facturation. Les chiffres
 * sont mis en forme ici ; l'achat (paiement Stripe) se lance dans CreditPacksPicker.
 */
export async function CreditPacksCard(props: {
  accountId: string;
  slug: string;
}) {
  const t = await getTranslations('billing.creditPacks');
  const format = await getFormatter();

  const money = (value: number, currency: string) =>
    format.number(value, {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    });

  const packs = CREDIT_PACKS.map((pack) => ({
    planId: pack.planId,
    credits: t('credits', { count: format.number(pack.credits) }),
    price: money(pack.price, pack.currency),
    perThousand: t('perThousand', {
      price: money((pack.price * 1000) / pack.credits, pack.currency),
    }),
  }));

  return (
    <Card data-test={'credit-packs-card'}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        <CreditPacksPicker
          accountId={props.accountId}
          slug={props.slug}
          packs={packs}
        />

        <p className={'text-muted-foreground text-sm'}>{t('validity')}</p>
      </CardContent>
    </Card>
  );
}
