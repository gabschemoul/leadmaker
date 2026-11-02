'use client';

import { useState } from 'react';

import Link from 'next/link';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as z from 'zod';

import {
  BillingConfig,
  type LineItemSchema,
  getPlanIntervals,
  getPrimaryLineItem,
} from '@kit/billing';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { LineItemDetails } from './line-item-details';
import { PlanCostDisplay } from './plan-cost-display';

interface Paths {
  signUp: string;
  return: string;
}

type Interval = 'month' | 'year';

export function PricingTable({
  config,
  paths,
  CheckoutButtonRenderer,
  redirectToCheckout = true,
  displayPlanDetails = true,
  alwaysDisplayMonthlyPrice = true,
}: {
  config: BillingConfig;
  paths: Paths;
  displayPlanDetails?: boolean;
  alwaysDisplayMonthlyPrice?: boolean;
  redirectToCheckout?: boolean;

  CheckoutButtonRenderer?: React.ComponentType<{
    planId: string;
    productId: string;
    highlighted?: boolean;
  }>;
}) {
  const intervals = getPlanIntervals(config).filter(Boolean) as Interval[];
  const [interval, setInterval] = useState(intervals[0]!);

  // Always filter out hidden products
  const visibleProducts = config.products.filter((product) => !product.hidden);

  return (
    <div className={'flex flex-col space-y-8 xl:space-y-12'}>
      <div className={'flex justify-center'}>
        {intervals.length > 1 ? (
          <PlanIntervalSwitcher
            intervals={intervals}
            interval={interval}
            setInterval={setInterval}
          />
        ) : null}
      </div>

      <div
        className={
          'flex flex-col items-start gap-y-10 lg:flex-row lg:gap-x-2.5' +
          ' justify-center'
        }
      >
        {visibleProducts.map((product) => {
          const plan = product.plans.find((plan) => {
            if (plan.paymentType === 'recurring') {
              return plan.interval === interval;
            }

            return plan;
          });

          if (!plan) {
            return null;
          }

          const primaryLineItem = getPrimaryLineItem(config, plan.id);

          if (!plan.custom && !primaryLineItem) {
            throw new Error(`Primary line item not found for plan ${plan.id}`);
          }

          return (
            <PricingItem
              selectable
              key={plan.id}
              plan={plan}
              redirectToCheckout={redirectToCheckout}
              primaryLineItem={primaryLineItem}
              product={product}
              paths={paths}
              displayPlanDetails={displayPlanDetails}
              alwaysDisplayMonthlyPrice={alwaysDisplayMonthlyPrice}
              CheckoutButton={CheckoutButtonRenderer}
            />
          );
        })}
      </div>
    </div>
  );
}

function PricingItem(
  props: React.PropsWithChildren<{
    className?: string;
    displayPlanDetails: boolean;

    paths: Paths;

    selectable: boolean;

    primaryLineItem: z.output<typeof LineItemSchema> | undefined;

    redirectToCheckout?: boolean;
    alwaysDisplayMonthlyPrice?: boolean;

    plan: {
      id: string;
      lineItems: z.output<typeof LineItemSchema>[];
      interval?: Interval;
      name?: string;
      href?: string;
      label?: string;
      custom?: boolean;
    };

    CheckoutButton?: React.ComponentType<{
      planId: string;
      productId: string;
      highlighted?: boolean;
    }>;

    product: {
      id: string;
      name: string;
      currency: string;
      description: string;
      badge?: string;
      highlighted?: boolean;
      features: string[];
    };
  }>,
) {
  const t = useTranslations();
  const highlighted = props.product.highlighted ?? false;
  const lineItem = props.primaryLineItem!;
  const isCustom = props.plan.custom ?? false;

  const i18nKey = lineItem?.unit ? `billing.units.${lineItem.unit}` : '';

  const unitLabel = lineItem?.unit
    ? t.has(i18nKey)
      ? t(i18nKey, {
          count: 1,
          defaultValue: lineItem.unit,
        } as never)
      : lineItem.unit
    : '';

  const isDefaultSeatUnit = lineItem?.unit === 'member';

  // we exclude flat line items from the details since
  // it doesn't need further explanation
  const lineItemsToDisplay = props.plan.lineItems.filter((item) => {
    return item.type !== 'flat';
  });

  const interval = props.plan.interval as Interval;

  return (
    <div
      data-cy={'subscription-plan'}
      className={cn(
        props.className,
        `relative flex w-full flex-1 grow flex-col items-stretch self-stretch lg:w-4/12 xl:max-w-[20rem]`,
      )}
    >
      <div className={'flex flex-col gap-y-4'}>
        {/* Carte du haut façon ElevenLabs : nom en haut, prix en bas. L'offre
            mise en avant reçoit le dégradé de la marque. */}
        <div
          className={cn(
            'relative flex min-h-[11.5rem] flex-col justify-between overflow-hidden rounded-2xl p-4',
            highlighted ? 'text-white' : 'bg-muted',
          )}
          style={
            highlighted
              ? {
                  background:
                    'radial-gradient(120% 90% at 0% 0%, #2b7fff 0%, transparent 60%), radial-gradient(110% 110% at 100% 100%, #ff8a4c 0%, transparent 55%), #e0441a',
                }
              : undefined
          }
        >
          <div className={'flex flex-col gap-y-1.5'}>
            <div className={'flex items-center justify-between gap-x-2'}>
              <b
                className={'text-2xl leading-8 font-normal tracking-[-0.01em]'}
              >
                <Trans
                  i18nKey={props.product.name}
                  defaults={props.product.name}
                />
              </b>

              <If condition={props.product.badge}>
                <span
                  className={cn(
                    'inline-flex h-6 items-center rounded-full px-2.5 text-xs',
                    highlighted
                      ? 'ring-1 ring-white/70'
                      : 'bg-card ring-pill-ring shadow-soft ring-[0.5px]',
                  )}
                >
                  <Trans
                    i18nKey={props.product.badge}
                    defaults={props.product.badge}
                  />
                </span>
              </If>
            </div>

            {/* hauteur réservée pour deux lignes : les prix et les boutons
                restent alignés d'une carte à l'autre (Prospectigo) */}
            <span
              className={cn(
                `min-h-[2.6rem] text-[0.875rem] leading-[1.45] tracking-[0.01em]`,
                highlighted ? 'text-white/80' : 'text-muted-foreground',
              )}
            >
              <Trans
                i18nKey={props.product.description}
                defaults={props.product.description}
              />
            </span>
          </div>

          <div className={'flex flex-col gap-y-0.5 pt-4'}>
            <Price
              highlighted={highlighted}
              isMonthlyPrice={props.alwaysDisplayMonthlyPrice}
              displayBillingPeriod={!props.plan.label}
            >
              <If
                condition={!isCustom}
                fallback={
                  <Trans
                    i18nKey={props.plan.label}
                    defaults={props.plan.label}
                  />
                }
              >
                <PlanCostDisplay
                  primaryLineItem={lineItem}
                  currencyCode={props.product.currency}
                  interval={interval}
                  alwaysDisplayMonthlyPrice={props.alwaysDisplayMonthlyPrice}
                />
              </If>
            </Price>

            <If condition={props.plan.name}>
              <span
                className={cn(
                  `flex items-center gap-x-1 text-xs first-letter:uppercase`,
                  highlighted ? 'text-white/80' : 'text-muted-foreground',
                )}
              >
                <span>
                  <If
                    condition={props.plan.interval}
                    fallback={<Trans i18nKey={'billing.lifetime'} />}
                  >
                    {(interval) => (
                      <Trans i18nKey={`billing.billingInterval.${interval}`} />
                    )}
                  </If>
                </span>

                <If condition={lineItem && lineItem?.type !== 'flat'}>
                  <span>/</span>

                  <span className={cn(`text-xs`)}>
                    <If condition={lineItem?.type === 'per_seat'}>
                      <If
                        condition={
                          Boolean(lineItem?.unit) && !isDefaultSeatUnit
                        }
                        fallback={<Trans i18nKey={'billing.perTeamMember'} />}
                      >
                        <Trans
                          i18nKey={'billing.perUnitShort'}
                          values={{
                            unit: unitLabel,
                          }}
                        />
                      </If>
                    </If>

                    <If
                      condition={
                        lineItem?.type !== 'per_seat' && lineItem?.unit
                      }
                    >
                      <Trans
                        i18nKey={'billing.perUnit'}
                        values={{
                          unit: lineItem?.unit,
                        }}
                      />
                    </If>
                  </span>
                </If>
              </span>
            </If>
          </div>
        </div>

        <If condition={props.selectable}>
          <If
            condition={props.plan.id && props.CheckoutButton}
            fallback={
              <DefaultCheckoutButton
                paths={props.paths}
                product={props.product}
                highlighted={highlighted}
                plan={props.plan}
                redirectToCheckout={props.redirectToCheckout}
              />
            }
          >
            {(CheckoutButton) => (
              <CheckoutButton
                highlighted={highlighted}
                planId={props.plan.id}
                productId={props.product.id}
              />
            )}
          </If>
        </If>

        <div className={'flex flex-col pt-2'}>
          <FeaturesList
            highlighted={highlighted}
            features={props.product.features}
          />
        </div>

        <If condition={props.displayPlanDetails && lineItemsToDisplay.length}>
          <div className={'flex flex-col space-y-2'}>
            <h6 className={'text-muted-foreground text-sm font-normal'}>
              <Trans i18nKey={'billing.detailsLabel'} />
            </h6>

            <LineItemDetails
              selectedInterval={props.plan.interval}
              currency={props.product.currency}
              lineItems={lineItemsToDisplay}
              alwaysDisplayMonthlyPrice={props.alwaysDisplayMonthlyPrice}
            />
          </div>
        </If>
      </div>
    </div>
  );
}

function FeaturesList(
  props: React.PropsWithChildren<{
    features: string[];
    highlighted: boolean;
  }>,
) {
  return (
    <ul className={'flex flex-col'}>
      {props.features.map((feature) => {
        return (
          <ListItem highlighted={props.highlighted} key={feature}>
            <Trans i18nKey={feature} defaults={feature} />
          </ListItem>
        );
      })}
    </ul>
  );
}

function Price({
  children,
  highlighted = false,
  isMonthlyPrice = true,
  displayBillingPeriod = true,
}: React.PropsWithChildren<{
  highlighted?: boolean;
  isMonthlyPrice?: boolean;
  displayBillingPeriod?: boolean;
}>) {
  return (
    <div className={`flex items-baseline gap-1`}>
      <span
        className={
          'font-heading flex items-center text-[2rem] leading-none font-light tracking-[-0.02em]'
        }
      >
        {children}
      </span>

      <If condition={isMonthlyPrice && displayBillingPeriod}>
        <span
          className={cn(
            'text-sm',
            highlighted ? 'text-white/80' : 'text-muted-foreground',
          )}
        >
          <span>/</span>

          <Trans i18nKey={'billing.perMonth'} />
        </span>
      </If>
    </div>
  );
}

function ListItem({
  children,
  highlighted,
}: React.PropsWithChildren<{
  highlighted: boolean;
}>) {
  return (
    <li
      className={
        'flex items-start gap-x-2.5 bg-[linear-gradient(to_right,var(--stone-300)_50%,transparent_0)] bg-[length:5px_1px] bg-bottom bg-repeat-x py-2.5 last:bg-none dark:bg-[linear-gradient(to_right,var(--stone-700)_50%,transparent_0)]'
      }
    >
      <Check
        className={cn('mt-[3px] size-3.5 shrink-0', {
          'text-foreground': highlighted,
          'text-muted-foreground': !highlighted,
        })}
      />

      <span
        className={
          'text-foreground text-[0.875rem] leading-[1.45] tracking-[0.01em]'
        }
      >
        {children}
      </span>
    </li>
  );
}

function PlanIntervalSwitcher(
  props: React.PropsWithChildren<{
    intervals: Interval[];
    interval: Interval;
    setInterval: (interval: Interval) => void;
  }>,
) {
  return (
    <div className={'bg-muted flex gap-x-0.5 rounded-full p-[3px]'}>
      {props.intervals.map((plan) => {
        const selected = plan === props.interval;

        const className = cn(
          'h-8 rounded-full px-4 transition-all focus:!ring-0',
          {
            ['hover:text-foreground text-muted-foreground']: !selected,
            ['bg-card text-foreground ring-pill-ring shadow-soft hover:bg-card cursor-default ring-[0.5px]']:
              selected,
          },
        );

        return (
          <Button
            size={'sm'}
            key={plan}
            variant={null}
            className={className}
            onClick={() => props.setInterval(plan)}
          >
            <span className={'flex items-center'}>
              <span
                className={'text-[0.875rem] font-normal first-letter:uppercase'}
              >
                <Trans i18nKey={`billing.billingInterval.${plan}`} />
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function DefaultCheckoutButton(
  props: React.PropsWithChildren<{
    plan: {
      id: string;
      name?: string | undefined;
      href?: string;
      buttonLabel?: string;
    };

    product: {
      name: string;
    };

    paths: Paths;
    redirectToCheckout?: boolean;

    highlighted?: boolean;
  }>,
) {
  const t = useTranslations();

  const signUpPath = props.paths.signUp;

  const searchParams = new URLSearchParams({
    next: props.paths.return,
    plan: props.plan.id,
    redirectToCheckout: props.redirectToCheckout ? 'true' : 'false',
  });

  const linkHref =
    props.plan.href ?? `${signUpPath}?${searchParams.toString()}`;

  const label = props.plan.buttonLabel ?? 'common.getStartedWithPlan';

  return (
    <Link className={'w-full'} href={linkHref}>
      <Button
        size={'lg'}
        className={'h-11 w-full rounded-full'}
        variant={'default'}
      >
        <span className={'text-[0.9375rem] font-normal'}>
          <Trans
            i18nKey={label}
            defaults={label}
            values={{
              plan: t.has(props.product.name as never)
                ? t(props.product.name as never)
                : props.product.name,
            }}
          />
        </span>
      </Button>
    </Link>
  );
}
