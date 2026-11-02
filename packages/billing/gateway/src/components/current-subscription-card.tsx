import { formatDate } from 'date-fns';
import { BadgeCheck, InfoIcon, MessageCircleWarning } from 'lucide-react';

import { PlanSchema, type ProductSchema } from '@kit/billing';
import { Tables } from '@kit/supabase/database';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';

import { CurrentPlanAlert } from './current-plan-alert';
import { CurrentPlanBadge } from './current-plan-badge';
import { LineItemDetails } from './line-item-details';

type Subscription = Tables<'subscriptions'>;
type LineItem = Tables<'subscription_items'>;

interface Props {
  subscription: Subscription & {
    items: LineItem[];
  };

  product: ProductSchema;
  plan: ReturnType<(typeof PlanSchema)['parse']>;
}

export function CurrentSubscriptionCard({
  subscription,
  product,
  plan,
}: React.PropsWithChildren<Props>) {
  const lineItems = subscription.items;
  const firstLineItem = lineItems[0];

  if (!firstLineItem) {
    throw new Error('No line items found in subscription');
  }

  const productLineItems = plan.lineItems;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey="billing.planCardTitle" />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey="billing.planCardDescription" />
        </CardDescription>
      </CardHeader>

      <CardContent className={'space-y-4 border-t pt-4 text-sm'}>
        <div className={'flex flex-col space-y-1'}>
          <div className={'flex items-center gap-x-4 text-lg font-medium'}>
            <span className={'flex items-center gap-x-1.5'}>
              <BadgeCheck
                className={'s-6 fill-green-500 text-white dark:text-stone-900'}
              />

              <span data-test={'current-plan-card-product-name'}>
                <Trans i18nKey={product.name} defaults={product.name} />
              </span>
            </span>

            <CurrentPlanBadge status={subscription.status} />
          </div>

          <div>
            <p className={'text-muted-foreground'}>
              <Trans
                i18nKey={product.description}
                defaults={product.description}
              />
            </p>
          </div>
        </div>

        {/*
         Only show the alert if the subscription requires action
          (e.g. trial ending soon, subscription canceled, etc.)
        */}
        <If condition={!subscription.active}>
          <div data-test={'current-plan-card-status-alert'}>
            <CurrentPlanAlert status={subscription.status} />
          </div>
        </If>

        <div className="flex flex-col gap-y-1 border-y border-dashed py-4">
          <span className="font-medium">
            <Trans i18nKey="billing.detailsLabel" />
          </span>

          <LineItemDetails
            lineItems={productLineItems}
            currency={subscription.currency}
            selectedInterval={firstLineItem.interval}
          />
        </div>

        <If condition={subscription.status === 'trialing'}>
          {() => (
            <Alert className={alertExtras.info}>
              <InfoIcon className={'h-4 w-4'} />

              <AlertTitle>
                <Trans i18nKey="billing.trialAlertTitle" />
              </AlertTitle>

              <AlertDescription>
                <Trans
                  i18nKey="billing.trialAlertDescription"
                  values={{
                    date: formatDate(
                      subscription.trial_ends_at ?? '',
                      'MMMM d, yyyy',
                    ),
                  }}
                />
              </AlertDescription>
            </Alert>
          )}
        </If>

        <If condition={subscription.cancel_at_period_end}>
          {() => (
            <Alert
              className={alertExtras.warning}
              data-test="subscription-cancellation-warning"
            >
              <MessageCircleWarning className={'h-4 w-4'} />

              <AlertTitle>
                <Trans i18nKey="billing.subscriptionCancelled" />
              </AlertTitle>

              <AlertDescription>
                <Trans
                  i18nKey="billing.cancelSubscriptionDate"
                  values={{
                    date: formatDate(
                      subscription.period_ends_at ?? '',
                      'MMMM d, yyyy',
                    ),
                  }}
                />
              </AlertDescription>
            </Alert>
          )}
        </If>
      </CardContent>
    </Card>
  );
}
