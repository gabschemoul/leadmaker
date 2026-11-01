import Link from 'next/link';

import { ArrowRight, Plus } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

import type { DashboardData } from '../_lib/server/dashboard.loader';
import { compareNextActions, nextAction } from '../campaigns/_lib/next-action';

/**
 * Le tableau de bord : quatre chiffres clés, puis une ligne par campagne
 * avec sa prochaine action et le bouton qui y mène.
 */
export async function DashboardNextActions(props: {
  data: DashboardData;
  campaignsPath: string;
  billingPath: string;
}) {
  const t = await getTranslations('campaigns.nextAction');
  const format = await getFormatter();
  const { kpis } = props.data;

  const rows = props.data.campaigns
    .map((campaign) => ({ ...campaign, action: nextAction(campaign.facts) }))
    .sort((a, b) => compareNextActions(a.action, b.action));

  const href = (campaignId: string, action: ReturnType<typeof nextAction>) =>
    `${props.campaignsPath}/${campaignId}?etape=${action.step}${action.statut ? `&statut=${action.statut}` : ''}`;

  return (
    <div className={'flex flex-col gap-6 pb-32'}>
      <div className={'grid grid-cols-2 gap-3 md:grid-cols-4'}>
        <Kpi
          label={t('kpi.toReview')}
          value={format.number(kpis.toReview)}
          hint={t('kpi.toReviewHint')}
          highlight={kpis.toReview > 0}
          testId={'kpi-to-review'}
        />
        <Kpi
          label={t('kpi.activeCampaigns')}
          value={format.number(kpis.activeCampaigns)}
          hint={
            kpis.activeCampaignsMax
              ? t('kpi.of', { max: format.number(kpis.activeCampaignsMax) })
              : t('kpi.unlimited')
          }
          testId={'kpi-active-campaigns'}
        />
        <Kpi
          label={t('kpi.outreach')}
          value={format.number(kpis.outreachBalance)}
          hint={
            kpis.outreachMonthly
              ? t('kpi.perMonth', { max: format.number(kpis.outreachMonthly) })
              : t('kpi.noPlan')
          }
          href={props.billingPath}
          testId={'kpi-outreach'}
        />
        <Kpi
          label={t('kpi.discovery')}
          value={format.number(kpis.discoveryBalance)}
          hint={
            kpis.discoveryMonthly
              ? t('kpi.perMonth', {
                  max: format.number(kpis.discoveryMonthly),
                })
              : t('kpi.noPlan')
          }
          href={props.billingPath}
          testId={'kpi-discovery'}
        />
      </div>

      <Card data-test={'dashboard-next-actions'}>
        <CardHeader
          className={
            'flex flex-row flex-wrap items-start justify-between gap-3'
          }
        >
          <div className={'flex flex-col gap-1.5'}>
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>

          <Button
            size={'sm'}
            nativeButton={false}
            data-test={'dashboard-new-campaign'}
            render={<Link href={`${props.campaignsPath}/new`} />}
          >
            <Plus className={'w-4'} />
            <span>{t('newCampaign')}</span>
          </Button>
        </CardHeader>

        <CardContent className={'flex flex-col'}>
          {rows.length === 0 ? (
            <div
              className={'flex flex-col items-center gap-3 py-10 text-center'}
              data-test={'dashboard-empty'}
            >
              <p className={'font-medium'}>{t('emptyTitle')}</p>
              <p className={'text-muted-foreground max-w-md text-sm'}>
                {t('emptyDescription')}
              </p>
              <Button
                nativeButton={false}
                render={<Link href={`${props.campaignsPath}/new`} />}
              >
                <Plus className={'w-4'} />
                <span>{t('emptyButton')}</span>
              </Button>
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                data-test={`dashboard-campaign-${row.action.kind}`}
                className={
                  'flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-3.5 first:border-t-0'
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-2.5 shrink-0 rounded-full',
                    row.action.kind === 'todo'
                      ? 'bg-brand'
                      : row.action.kind === 'working'
                        ? 'bg-primary'
                        : 'bg-muted-foreground/40',
                  )}
                />

                <div className={'flex min-w-0 flex-1 basis-60 flex-col'}>
                  <Link
                    href={`${props.campaignsPath}/${row.id}`}
                    className={'truncate font-medium hover:underline'}
                  >
                    {row.name}
                  </Link>

                  <span className={'text-muted-foreground truncate text-sm'}>
                    {t(`${row.action.key}.text`, row.action.values)}
                  </span>
                </div>

                <Button
                  size={'sm'}
                  variant={row.action.kind === 'todo' ? 'default' : 'outline'}
                  nativeButton={false}
                  render={<Link href={href(row.id, row.action)} />}
                >
                  <span>{t(`${row.action.key}.button`)}</span>
                  <ArrowRight className={'w-4'} />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi(props: {
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
  href?: string;
  testId: string;
}) {
  const body = (
    <>
      <span className={'text-muted-foreground text-xs'}>{props.label}</span>
      <span
        className={cn(
          'font-heading text-2xl font-extrabold tabular-nums',
          props.highlight && 'text-primary',
        )}
      >
        {props.value}
      </span>
      <span className={'text-muted-foreground text-xs'}>{props.hint}</span>
    </>
  );

  const className =
    'bg-card flex flex-col gap-0.5 rounded-xl border px-4 py-3.5';

  return props.href ? (
    <Link
      href={props.href}
      className={cn(className, 'hover:bg-muted transition-colors')}
      data-test={props.testId}
    >
      {body}
    </Link>
  ) : (
    <div className={className} data-test={props.testId}>
      {body}
    </div>
  );
}
