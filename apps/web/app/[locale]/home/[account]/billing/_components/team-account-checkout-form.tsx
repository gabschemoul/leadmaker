'use client';

import { useState } from 'react';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';

import { TriangleAlertIcon } from 'lucide-react';
import { useAction } from 'next-safe-action/hooks';

import { PlanPicker } from '@kit/billing-gateway/components';
import { useAppEvents } from '@kit/shared/events';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';

import billingConfig from '~/config/billing.config';
import {
  type BillingCurrency,
  billingConfigFor,
} from '~/lib/leadmaker/billing-currency';

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

export function TeamAccountCheckoutForm(params: {
  accountId: string;
  customerId: string | null | undefined;
  /** euros pour les clients européens, dollars pour les autres (billing-currency.ts) */
  currency: BillingCurrency;
}) {
  const routeParams = useParams();
  const appEvents = useAppEvents();

  const [checkoutToken, setCheckoutToken] = useState<string | undefined>(
    undefined,
  );
  const [error, setError] = useState(false);

  const { execute, isPending } = useAction(createTeamAccountCheckoutSession, {
    onSuccess: ({ data }) => {
      if (data?.checkoutToken) {
        setCheckoutToken(data.checkoutToken);
      }
    },
    onError: () => {
      setError(true);
    },
  });

  // If the checkout token is set, render the embedded checkout component
  if (checkoutToken) {
    return (
      <EmbeddedCheckout
        checkoutToken={checkoutToken}
        provider={billingConfig.provider}
        onClose={() => setCheckoutToken(undefined)}
      />
    );
  }

  // only allow trial if the user is not already a customer
  const canStartTrial = !params.customerId;

  // Otherwise, render the plan picker component
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey={'billing.manageTeamPlan'} />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey={'billing.manageTeamPlanDescription'} />
        </CardDescription>
      </CardHeader>

      <CardContent className={'space-y-4'}>
        <If condition={error}>
          <Alert variant={'destructive'}>
            <TriangleAlertIcon className={'h-4'} />

            <AlertTitle>
              <Trans i18nKey={'billing.planPickerAlertErrorTitle'} />
            </AlertTitle>

            <AlertDescription>
              <Trans i18nKey={'billing.planPickerAlertErrorDescription'} />
            </AlertDescription>
          </Alert>
        </If>

        <PlanPicker
          pending={isPending}
          config={billingConfigFor(params.currency)}
          canStartTrial={canStartTrial}
          onSubmit={({ planId, productId }) => {
            const slug = routeParams.account as string;

            appEvents.emit({
              type: 'checkout.started',
              payload: {
                planId,
                account: slug,
              },
            });

            execute({
              planId,
              productId,
              slug,
              accountId: params.accountId,
            });
          }}
        />
      </CardContent>
    </Card>
  );
}
