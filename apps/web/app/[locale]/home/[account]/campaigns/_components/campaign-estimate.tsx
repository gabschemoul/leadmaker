'use client';

/**
 * Rôle : encart d'estimation du formulaire de campagne (calcul rapide, puis mesure réelle à la demande).
 * Données : estimateCampaignAction (lm_estimate_campaign) et useRealEstimate (lm_request_estimate + suivi).
 * Écritures : la mesure réelle crée une estimation et sa tâche robot (sans crédit).
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useFormatter } from 'next-intl';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Spinner } from '@kit/ui/spinner';
import { Trans } from '@kit/ui/trans';

import type { Targeting } from '../_lib/schema/campaign.schema';
import type { EstimateFilters } from '../_lib/schema/campaign.schema';
import { estimateCampaignAction } from '../_lib/server/estimate-actions';
import { useDebouncedValue } from '../_lib/use-debounced-value';
import {
  type RealEstimateFilters,
  type RealEstimateState,
  useRealEstimate,
} from '../_lib/use-real-estimate';

export function CampaignEstimate(props: {
  accountId: string;
  countryCode: string;
  targeting: Targeting | null;
  filters: EstimateFilters;
  realFilters: RealEstimateFilters;
  balance: number;
}) {
  const format = useFormatter();

  // la clé sérialisée ne change que si le ciblage change vraiment
  const key = useDebouncedValue(
    props.targeting
      ? JSON.stringify({
          countryCode: props.countryCode,
          targeting: props.targeting,
          filters: props.filters,
        })
      : null,
    500,
  );

  const { data, isFetching, isError } = useQuery({
    queryKey: ['lm-campaign-estimate', key],
    enabled: key !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async () => {
      const input = JSON.parse(key!) as {
        countryCode: string;
        targeting: Targeting;
        filters: EstimateFilters;
      };

      const result = await estimateCampaignAction(input);

      if (!result?.data) {
        throw new Error(result?.serverError ?? 'estimate failed');
      }

      return result.data;
    },
  });

  const number = (value: number) => format.number(value);
  const realKey =
    props.targeting === null
      ? null
      : JSON.stringify({
          countryCode: props.countryCode,
          targeting: props.targeting,
          filters: props.realFilters,
        });

  const real = useRealEstimate(props.accountId, realKey);

  const credits =
    real.result?.status === 'done' && !real.stale
      ? (real.result.credits_per_prospect ?? 1)
      : null;

  const exceedsBalance =
    real.result?.status === 'done' &&
    (real.result.expected ?? 0) * (credits ?? 1) > props.balance;

  return (
    <Card data-test={'campaign-estimate'}>
      <CardHeader>
        <CardTitle className={'flex items-center gap-2'}>
          <Trans i18nKey={'campaigns.estimate.title'} />

          {isFetching ? <Spinner className={'size-4'} /> : null}
        </CardTitle>

        <CardDescription>
          <Trans i18nKey={'campaigns.estimate.description'} />
        </CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        {key === null ? (
          <p className={'text-muted-foreground text-sm'}>
            <Trans i18nKey={'campaigns.estimate.incomplete'} />
          </p>
        ) : isError && !data ? (
          <p className={'text-destructive text-sm'}>
            <Trans i18nKey={'campaigns.errors.estimateFailed'} />
          </p>
        ) : (
          <dl className={'grid grid-cols-2 gap-3 text-sm'}>
            <EstimateItem
              label={'campaigns.estimate.cities'}
              value={data ? number(data.cities) : '–'}
            />

            <EstimateItem
              label={'campaigns.estimate.categories'}
              value={data ? number(data.categories) : '–'}
            />

            <EstimateItem
              label={'campaigns.estimate.searches'}
              value={data ? number(data.searches) : '–'}
            />
          </dl>
        )}

        {realKey !== null ? (
          <RealEstimate state={real} formatNumber={number} />
        ) : null}

        <div className={'border-t pt-3 text-sm'}>
          <div className={'flex items-center justify-between'}>
            <span className={'text-muted-foreground'}>
              <Trans i18nKey={'campaigns.estimate.balance'} />
            </span>

            <span className={'font-medium tabular-nums'}>
              {number(props.balance)}
            </span>
          </div>

          <p className={'text-muted-foreground mt-1 text-xs'}>
            {credits !== null ? (
              <Trans
                i18nKey={'campaigns.estimate.creditsHintPriced'}
                values={{ count: credits }}
              />
            ) : (
              <Trans i18nKey={'campaigns.estimate.creditsHint'} />
            )}
          </p>
        </div>

        {exceedsBalance ? (
          <Alert className={alertExtras.warning}>
            <TriangleAlert className={'h-4'} />

            <AlertDescription>
              <Trans i18nKey={'campaigns.estimate.exceedsBalance'} />
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EstimateItem(props: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={'flex flex-col gap-0.5'}>
      <dt className={'text-muted-foreground text-xs'}>
        <Trans i18nKey={props.label} />
      </dt>

      <dd
        className={
          props.highlight
            ? 'text-lg font-medium tabular-nums'
            : 'font-medium tabular-nums'
        }
      >
        {props.value}
      </dd>
    </div>
  );
}

function RealEstimate(props: {
  state: RealEstimateState;
  formatNumber: (value: number) => string;
}) {
  const { result, stale, pending, request } = props.state;
  const number = props.formatNumber;

  const running = pending || result?.status === 'running';

  return (
    <div className={'flex flex-col gap-2 border-t pt-3'}>
      <p className={'text-sm font-medium'}>
        <Trans i18nKey={'campaigns.estimate.real.title'} />
      </p>

      {result?.status === 'done' && !stale ? (
        <div
          className={'flex flex-col gap-1'}
          data-test={'real-estimate-result'}
        >
          <p className={'text-lg font-medium'}>
            {result.mode === 'exact' ? (
              <Trans
                i18nKey={'campaigns.estimate.real.exact'}
                values={{ count: result.expected ?? 0 }}
              />
            ) : (
              <Trans
                i18nKey={'campaigns.estimate.real.sample'}
                values={{
                  low: number(result.expected_low ?? 0),
                  high: number(result.expected_high ?? 0),
                }}
              />
            )}
          </p>

          <p className={'text-muted-foreground text-xs'}>
            {result.mode === 'exact' ? (
              <Trans i18nKey={'campaigns.estimate.real.exactHint'} />
            ) : (
              <Trans
                i18nKey={'campaigns.estimate.real.sampleHint'}
                values={{
                  sample: number(result.sample_searches),
                  total: number(result.total_searches),
                }}
              />
            )}
          </p>

          <p
            className={'mt-1 text-sm font-medium'}
            data-test={'real-estimate-pricing'}
          >
            <Trans
              i18nKey={'campaigns.estimate.real.pricing'}
              values={{ count: result.credits_per_prospect ?? 1 }}
            />
          </p>

          <p className={'text-muted-foreground text-xs'}>
            <Trans
              i18nKey={'campaigns.estimate.real.pricingHint'}
              values={{ rate: Math.round((result.rate ?? 0) * 1000) / 10 }}
            />
          </p>
        </div>
      ) : running && !stale ? (
        <div className={'flex flex-col gap-2'}>
          <p
            className={'text-muted-foreground flex items-center gap-2 text-sm'}
          >
            <Spinner className={'size-4'} />
            <Trans
              i18nKey={'campaigns.estimate.real.running'}
              values={{
                done: result?.done_searches ?? 0,
                total: result?.sample_searches ?? 0,
              }}
            />
          </p>

          <div className={'bg-muted h-1.5 w-full overflow-hidden rounded-full'}>
            <div
              className={'bg-primary h-full transition-all'}
              style={{
                width: `${
                  result && result.sample_searches > 0
                    ? Math.round(
                        (result.done_searches / result.sample_searches) * 100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      ) : (
        <p className={'text-muted-foreground text-xs'}>
          {stale && result ? (
            <Trans i18nKey={'campaigns.estimate.real.changed'} />
          ) : result?.status === 'failed' ? (
            <Trans i18nKey={'campaigns.estimate.real.failed'} />
          ) : (
            <Trans i18nKey={'campaigns.estimate.real.intro'} />
          )}
        </p>
      )}

      {!running || stale ? (
        <Button
          type={'button'}
          variant={result && !stale ? 'outline' : 'default'}
          size={'sm'}
          data-test={'real-estimate-button'}
          onClick={request}
        >
          <Trans
            i18nKey={
              result && !stale
                ? 'campaigns.estimate.real.again'
                : 'campaigns.estimate.real.button'
            }
          />
        </Button>
      ) : null}
    </div>
  );
}
