'use client';

import { useState } from 'react';

import dynamic from 'next/dynamic';

import { TriangleAlertIcon } from 'lucide-react';
import { useAction } from 'next-safe-action/hooks';

import { useAppEvents } from '@kit/shared/events';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';

import billingConfig from '~/config/billing.config';
import { CREDIT_PACKS_PRODUCT_ID } from '~/lib/leadmaker/credit-packs';

import { createTeamAccountCheckoutSession } from '../_lib/server/server-actions';

const EmbeddedCheckout = dynamic(
  async () => {
    const { EmbeddedCheckout } = await import('@kit/billing-gateway/checkout');

    return {
      default: EmbeddedCheckout,
    };
  },
  {
    ssr: false,
  },
);

type PackTile = {
  planId: string;
  credits: string;
  price: string;
  perThousand: string;
};

/**
 * Tuiles des packs de crédits et bouton « Acheter » : même paiement que le choix du forfait
 * (createTeamAccountCheckoutSession, produit caché `credit-packs`) ; paiement intégré dans une fenêtre,
 * ou redirection vers la page Stripe selon la configuration.
 */
export function CreditPacksPicker(props: {
  accountId: string;
  slug: string;
  packs: PackTile[];
}) {
  const appEvents = useAppEvents();

  const [state, setState] = useState<{
    selected: string | null;
    checkoutToken: string | null;
    error: boolean;
  }>({ selected: null, checkoutToken: null, error: false });

  const { execute, isPending } = useAction(createTeamAccountCheckoutSession, {
    onSuccess: ({ data }) => {
      setState((current) => ({
        ...current,
        checkoutToken: data?.checkoutToken ?? null,
      }));
    },
    onError: () => {
      setState((current) => ({ ...current, error: true }));
    },
  });

  const buy = (planId: string) => {
    setState({ selected: planId, checkoutToken: null, error: false });

    appEvents.emit({
      type: 'checkout.started',
      payload: { planId, account: props.slug },
    });

    execute({
      planId,
      productId: CREDIT_PACKS_PRODUCT_ID,
      slug: props.slug,
      accountId: props.accountId,
    });
  };

  return (
    <div className={'flex flex-col gap-4'}>
      <If condition={state.error}>
        <Alert variant={'destructive'}>
          <TriangleAlertIcon className={'h-4'} />

          <AlertTitle>
            <Trans i18nKey={'billing.planPickerAlertErrorTitle'} />
          </AlertTitle>

          <AlertDescription>
            <Trans i18nKey={'billing.creditPacks.error'} />
          </AlertDescription>
        </Alert>
      </If>

      <div className={'grid gap-3 sm:grid-cols-3'}>
        {props.packs.map((pack) => (
          <div
            key={pack.planId}
            className={'flex flex-col gap-3 rounded-xl border p-4'}
            data-test={`credit-pack-${pack.planId}`}
          >
            <div className={'flex flex-col gap-1'}>
              <p className={'font-display text-xl font-medium tabular-nums'}>
                {pack.credits}
              </p>

              <p className={'text-lg font-medium tabular-nums'}>{pack.price}</p>

              <p className={'text-muted-foreground text-sm tabular-nums'}>
                {pack.perThousand}
              </p>
            </div>

            <Button
              className={'mt-auto'}
              data-test={`credit-pack-buy-${pack.planId}`}
              loading={isPending && state.selected === pack.planId}
              disabled={isPending}
              onClick={() => buy(pack.planId)}
            >
              <Trans i18nKey={'billing.creditPacks.buy'} />
            </Button>
          </div>
        ))}
      </div>

      {state.checkoutToken ? (
        <EmbeddedCheckout
          checkoutToken={state.checkoutToken}
          provider={billingConfig.provider}
          onClose={() =>
            setState((current) => ({ ...current, checkoutToken: null }))
          }
        />
      ) : null}
    </div>
  );
}
