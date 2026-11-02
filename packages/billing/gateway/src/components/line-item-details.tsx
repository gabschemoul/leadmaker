'use client';

import { PlusSquare } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as z from 'zod';

import type { LineItemSchema } from '@kit/billing';
import { formatCurrency } from '@kit/shared/utils';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

const className = 'flex text-secondary-foreground items-center text-sm';

export function LineItemDetails(
  props: React.PropsWithChildren<{
    lineItems: z.output<typeof LineItemSchema>[];
    currency: string;
    selectedInterval?: string | undefined;
    alwaysDisplayMonthlyPrice?: boolean;
  }>,
) {
  const t = useTranslations('billing');
  const locale = useLocale();
  const currencyCode = props?.currency.toLowerCase();

  const shouldDisplayMonthlyPrice =
    props.alwaysDisplayMonthlyPrice && props.selectedInterval === 'year';

  const getUnitLabel = (unit: string | undefined, count: number) => {
    if (!unit) {
      return '';
    }

    const i18nKey = `units.${unit}` as never;

    if (!t.has(i18nKey)) {
      return unit;
    }

    return t(i18nKey, {
      count,
      defaultValue: unit,
    } as never);
  };

  const getDisplayCost = (cost: number, hasTiers: boolean) => {
    if (shouldDisplayMonthlyPrice && !hasTiers) {
      return cost / 12;
    }

    return cost;
  };

  return (
    <div className={'flex flex-col space-y-1'}>
      {props.lineItems.map((item, index) => {
        // If the item has a description, we render it as a simple text
        // and pass the item as values to the translation so we can use
        // the item properties in the translation.
        if (item.description) {
          return (
            <div key={index} className={className}>
              <span className={'flex items-center space-x-1.5'}>
                <PlusSquare className={'w-4'} />

                <Trans
                  i18nKey={item.description}
                  values={item}
                  defaults={item.description}
                />
              </span>
            </div>
          );
        }

        const SetupFee = () => (
          <If condition={item.setupFee}>
            <div className={className}>
              <span className={'flex items-center space-x-1'}>
                <PlusSquare className={'w-3'} />

                <span>
                  <Trans
                    i18nKey={'billing.setupFee'}
                    values={{
                      setupFee: formatCurrency({
                        currencyCode,
                        value: item.setupFee as number,
                        locale,
                      }),
                    }}
                  />
                </span>
              </span>
            </div>
          </If>
        );

        const unit =
          item.unit ?? (item.type === 'per_seat' ? 'member' : undefined);

        const hasTiers = Boolean(item.tiers?.length);
        const isDefaultSeatUnit = unit === 'member';

        const FlatFee = () => (
          <div className={'flex flex-col'}>
            <div className={cn(className, 'space-x-1')}>
              <span className={'flex items-center space-x-1'}>
                <span className={'flex items-center space-x-1.5'}>
                  <PlusSquare className={'w-3'} />

                  <span>
                    <Trans i18nKey={'billing.basePlan'} />
                  </span>
                </span>

                <span>
                  <If
                    condition={props.selectedInterval}
                    fallback={<Trans i18nKey={'billing.lifetime'} />}
                  >
                    (
                    <Trans
                      i18nKey={`billing.billingInterval.${props.selectedInterval}`}
                    />
                    )
                  </If>
                </span>
              </span>

              <span>-</span>

              <span className={'text-xs font-medium'}>
                {formatCurrency({
                  currencyCode,
                  value: getDisplayCost(item.cost, hasTiers),
                  locale,
                })}
              </span>
            </div>

            <SetupFee />

            <If condition={item.tiers?.length}>
              <span className={'flex items-center space-x-1.5'}>
                <PlusSquare className={'w-3'} />

                <span className={'flex gap-x-2 text-sm'}>
                  <span>
                    <Trans
                      i18nKey={'billing.perUnit'}
                      values={{
                        unit: getUnitLabel(unit, 1),
                      }}
                    />
                  </span>
                </span>
              </span>

              <Tiers item={item} currency={props.currency} unit={unit} />
            </If>
          </div>
        );

        const PerSeat = () => (
          <div key={index} className={'flex flex-col'}>
            <div className={className}>
              <span className={'flex items-center space-x-1.5'}>
                <PlusSquare className={'w-3'} />

                <span>
                  <If
                    condition={Boolean(unit) && !isDefaultSeatUnit}
                    fallback={<Trans i18nKey={'billing.perTeamMember'} />}
                  >
                    <Trans
                      i18nKey={'billing.perUnitShort'}
                      values={{
                        unit: getUnitLabel(unit, 1),
                      }}
                    />
                  </If>
                </span>

                <If condition={!item.tiers?.length}>
                  <span>-</span>

                  <span className={'font-medium'}>
                    {formatCurrency({
                      currencyCode,
                      value: getDisplayCost(item.cost, hasTiers),
                      locale,
                    })}
                  </span>
                </If>
              </span>
            </div>

            <SetupFee />

            <If condition={item.tiers?.length}>
              <Tiers item={item} currency={props.currency} unit={unit} />
            </If>
          </div>
        );

        const Metered = () => (
          <div key={index} className={'flex flex-col'}>
            <div className={className}>
              <span className={'flex items-center space-x-1'}>
                <span className={'flex items-center space-x-1.5'}>
                  <PlusSquare className={'w-3'} />

                  <span className={'flex space-x-1'}>
                    <span>
                      <Trans
                        i18nKey={'billing.perUnit'}
                        values={{
                          unit: getUnitLabel(unit, 1),
                        }}
                      />
                    </span>
                  </span>
                </span>
              </span>

              {/* If there are no tiers, there is a flat cost for usage */}
              <If condition={!item.tiers?.length}>
                <span className={'font-medium'}>
                  {formatCurrency({
                    currencyCode,
                    value: getDisplayCost(item.cost, hasTiers),
                    locale,
                  })}
                </span>
              </If>
            </div>

            <SetupFee />

            {/* If there are tiers, we render them as a list */}
            <If condition={item.tiers?.length}>
              <Tiers item={item} currency={props.currency} unit={unit} />
            </If>
          </div>
        );

        switch (item.type) {
          case 'flat':
            return <FlatFee key={item.id} />;

          case 'per_seat':
            return <PerSeat key={item.id} />;

          case 'metered': {
            return <Metered key={item.id} />;
          }
        }
      })}
    </div>
  );
}

function Tiers({
  currency,
  item,
  unit,
}: {
  currency: string;
  unit?: string;
  item: z.output<typeof LineItemSchema>;
}) {
  const t = useTranslations('billing');
  const locale = useLocale();

  // Helper to safely convert tier values to numbers for pluralization
  // Falls back to plural form (2) for 'unlimited' values
  const getSafeCount = (value: number | 'unlimited' | string): number => {
    if (value === 'unlimited') return 2;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(num) ? 2 : num;
  };

  const getUnitLabel = (count: number) => {
    if (!unit) return '';

    return t(
      `units.${unit}` as never,
      {
        count,
        defaultValue: unit,
      } as never,
    );
  };

  const tiers = item.tiers?.map((tier, index) => {
    const tiersLength = item.tiers?.length ?? 0;
    const previousTier = item.tiers?.[index - 1];
    const isLastTier = tier.upTo === 'unlimited';

    const previousTierFrom =
      previousTier?.upTo === 'unlimited'
        ? 'unlimited'
        : previousTier === undefined
          ? 0
          : previousTier.upTo + 1 || 0;

    const upTo = tier.upTo;
    const previousTierUpTo =
      typeof previousTier?.upTo === 'number' ? previousTier.upTo : undefined;
    const currentTierUpTo = typeof upTo === 'number' ? upTo : undefined;
    const rangeCount =
      previousTierUpTo !== undefined && currentTierUpTo !== undefined
        ? currentTierUpTo - previousTierUpTo
        : undefined;
    const isIncluded = tier.cost === 0;

    return (
      <span className={'text-secondary-foreground text-xs'} key={index}>
        <span>-</span>{' '}
        <If condition={isLastTier}>
          <span className={'font-medium'}>
            {formatCurrency({
              currencyCode: currency.toLowerCase(),
              value: tier.cost,
              locale,
            })}
          </span>{' '}
          <If condition={tiersLength > 1}>
            <span>
              <Trans
                i18nKey={'billing.andAbove'}
                values={{
                  unit: getUnitLabel(getSafeCount(previousTierFrom) - 1),
                  previousTier: getSafeCount(previousTierFrom) - 1,
                }}
              />
            </span>
          </If>
          <If condition={tiersLength === 1}>
            <span>
              <Trans
                i18nKey={'billing.forEveryUnit'}
                values={{
                  unit: getUnitLabel(1),
                }}
              />
            </span>
          </If>
        </If>{' '}
        <If condition={!isLastTier}>
          <If condition={isIncluded}>
            <span>
              <Trans
                i18nKey={'billing.includedUpTo'}
                values={{
                  unit: getUnitLabel(getSafeCount(upTo)),
                  upTo,
                }}
              />
            </span>
          </If>{' '}
          <If condition={!isIncluded}>
            <span className={'font-medium'}>
              {formatCurrency({
                currencyCode: currency.toLowerCase(),
                value: tier.cost,
                locale,
              })}
            </span>{' '}
            <span>
              <Trans
                i18nKey={'billing.fromPreviousTierUpTo'}
                values={{
                  previousTierFrom,
                  unit: getUnitLabel(1),
                  unitPlural: getUnitLabel(getSafeCount(rangeCount ?? upTo)),
                  upTo: rangeCount ?? upTo,
                }}
              />
            </span>
          </If>
        </If>
      </span>
    );
  });

  return <div className={'my-1 flex flex-col space-y-1.5'}>{tiers}</div>;
}
