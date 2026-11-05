'use client';

import { ArrowUpRight } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

/** `pending` : ouverture du portail de paiement en cours (roue sur le bouton). */
export function BillingPortalCard(props: { pending?: boolean } = {}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey="billing.billingPortalCardTitle" />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey="billing.billingPortalCardDescription" />
        </CardDescription>
      </CardHeader>

      <CardContent className={'space-y-2'}>
        <div>
          <Button
            type="submit"
            loading={props.pending}
            data-test={'manage-billing-redirect-button'}
          >
            <span>
              <Trans i18nKey="billing.billingPortalCardButton" />
            </span>

            <ArrowUpRight className={'h-4'} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
