'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useFormatter } from 'next-intl';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
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
import { estimateCampaignAction } from '../_lib/server/server-actions';
import { useDebouncedValue } from '../_lib/use-debounced-value';

export function CampaignEstimate(props: {
  countryCode: string;
  targeting: Targeting | null;
  filters: EstimateFilters;
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
  const exceedsBalance =
    key !== null && data ? data.expectedProspects > props.balance : false;

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

            <EstimateItem
              label={'campaigns.estimate.prospects'}
              value={data ? `≈ ${number(data.expectedProspects)}` : '–'}
              highlight
            />
          </dl>
        )}

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
            <Trans i18nKey={'campaigns.estimate.creditsHint'} />
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
            ? 'text-lg font-semibold tabular-nums'
            : 'font-medium tabular-nums'
        }
      >
        {props.value}
      </dd>
    </div>
  );
}
