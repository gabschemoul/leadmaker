import { BadgeCheck } from 'lucide-react';

import { PlanSchema, type ProductSchema } from '@kit/billing';
import { Tables } from '@kit/supabase/database';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

import { CurrentPlanBadge } from './current-plan-badge';
import { LineItemDetails } from './line-item-details';

type Order = Tables<'orders'>;
type LineItem = Tables<'order_items'>;

interface Props {
  order: Order & {
    items: LineItem[];
  };

  product: ProductSchema;
  plan: ReturnType<(typeof PlanSchema)['parse']>;
}

export function CurrentLifetimeOrderCard({
  order,
  product,
  plan,
}: React.PropsWithChildren<Props>) {
  const lineItems = order.items;
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

      <CardContent className={'gap-y-4 text-sm'}>
        <div className={'flex flex-col space-y-1'}>
          <div className={'flex items-center gap-x-3 text-lg font-medium'}>
            <BadgeCheck
              className={
                's-6 fill-green-500 text-white dark:fill-white dark:text-black'
              }
            />

            <span>{product.name}</span>

            <CurrentPlanBadge status={order.status} />
          </div>
        </div>

        <div>
          <div className="flex flex-col gap-y-1">
            <span className="font-medium">
              <Trans i18nKey="billing.detailsLabel" />
            </span>

            <LineItemDetails
              lineItems={productLineItems}
              currency={order.currency}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
