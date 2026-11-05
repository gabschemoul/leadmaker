'use client';

/**
 * Rôle : étape Trouver d'une campagne : progression de la recherche en direct, lancement / pause, chiffres clés.
 * Données : fetchCampaignLive (lm_campaigns, lm_campaign_progress, lm_campaign_pricing, lm_prospects) + temps réel sur lm_prospects et lm_campaign_categories.
 * Écritures : startCampaignAction / pauseCampaignAction.
 */

import { useEffect } from 'react';

import Link from 'next/link';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Pause, PenLine, Play, TriangleAlert } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import { toast } from '@kit/ui/sonner';
import { Spinner } from '@kit/ui/spinner';
import { Trans } from '@kit/ui/trans';

import { LocalDateTime } from '~/components/local-date-time';

import { CampaignStatusBadge } from '../../../_components/leadmaker/campaign-status-badge';
import { ProspectsTable } from '../../../_components/leadmaker/prospects-table';
import { type CampaignLive, fetchCampaignLive } from '../../_lib/campaign-live';
import {
  pauseCampaignAction,
  startCampaignAction,
} from '../../_lib/server/campaign-lifecycle-actions';

const REFRESH_INTERVAL = 10_000;

/**
 * Étape 2, Trouver : la recherche Google Maps (lancer, mettre en pause),
 * son avancement en direct et les derniers prospects trouvés.
 */
export function DiscoverStep(props: {
  campaignId: string;
  accountId: string;
  campaignsPath: string;
  allProspectsHref: string;
  canDelete: boolean;
  billingPath: string;
  formsHref: string;
  writeHref: string;
  /** message rédigé et expéditeur renseignés */
  readyToWrite: boolean;
  initialData: CampaignLive;
}) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const queryKey = ['lm-campaign-live', props.campaignId];

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchCampaignLive(client, props.campaignId),
    initialData: props.initialData,
    staleTime: 5_000,
    // filet de sécurité : le temps réel (useCampaignRealtime) rafraîchit dès qu'il se passe quelque chose ;
    // pendant la mesure de la difficulté (estimation avant lancement), on suit l'avancement de près
    refetchInterval: (query) =>
      query.state.data?.pricing.estimateStatus === 'running'
        ? 3_000
        : query.state.data?.status === 'running'
          ? REFRESH_INTERVAL
          : false,
  });

  useCampaignRealtime(props.campaignId, queryKey);

  const noCredits =
    data.status === 'paused' && data.pausedReason === 'no_credits';

  return (
    <div className={'flex flex-col gap-4'} data-test={'campaign-step-discover'}>
      {noCredits ? (
        <Alert className={alertExtras.warning} data-test={'no-credits-alert'}>
          <TriangleAlert className={'h-4'} />

          <AlertTitle>
            <Trans i18nKey={'campaigns.detail.noCreditsTitle'} />
          </AlertTitle>

          <AlertDescription>
            <Trans
              i18nKey={'campaigns.detail.noCreditsDescription'}
              components={{
                link: (chunks: React.ReactNode) => (
                  <Link className={'underline'} href={props.billingPath}>
                    {chunks}
                  </Link>
                ),
              }}
            />
          </AlertDescription>
        </Alert>
      ) : null}

      <ProgressCard live={data}>
        <div className={'flex flex-wrap items-center gap-2'}>
          <CampaignActions
            campaignId={props.campaignId}
            status={data.status}
            queryKey={queryKey}
          />

          {data.status !== 'draft' && !props.readyToWrite ? (
            <Button
              variant={'secondary'}
              nativeButton={false}
              data-test={'campaign-write-meanwhile'}
              render={<Link href={props.writeHref} />}
            >
              <PenLine className={'w-4'} />
              <span>
                <Trans i18nKey={'campaigns.steps.discover.whileRunning'} />
              </span>
            </Button>
          ) : null}

          {data.status !== 'draft' && props.readyToWrite ? (
            <Button
              variant={'outline'}
              nativeButton={false}
              data-test={'campaign-step-next'}
              render={<Link href={props.writeHref} />}
            >
              <span>
                <Trans i18nKey={'campaigns.steps.discover.next'} />
              </span>
              <ArrowRight className={'w-4'} />
            </Button>
          ) : null}
        </div>
      </ProgressCard>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'campaigns.detail.latestProspectsTitle'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'campaigns.detail.latestProspectsDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent className={'flex flex-col gap-4'}>
          <ProspectsTable
            prospects={data.prospects}
            accountId={props.accountId}
            campaignsPath={props.campaignsPath}
            canDelete={props.canDelete}
            formsHref={props.formsHref}
            sorting={[{ id: 'date', desc: true }]}
            hiddenColumns={['campaign']}
            onMutated={() => void queryClient.invalidateQueries({ queryKey })}
            noResultsMessage={
              <Trans i18nKey={'campaigns.detail.noProspects'} />
            }
          />

          <div className={'flex justify-end'}>
            <Button
              variant={'link'}
              nativeButton={false}
              data-test={'campaign-all-prospects-link'}
              render={<Link href={props.allProspectsHref} />}
            >
              <span>
                <Trans i18nKey={'prospects.campaignLink'} />
              </span>

              <ArrowRight className={'w-4'} />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignActions(props: {
  campaignId: string;
  status: CampaignLive['status'];
  queryKey: unknown[];
}) {
  const t = useTranslations();
  const queryClient = useQueryClient();

  const callbacks = (successKey: string) => ({
    onSuccess: () => {
      toast.success(t(successKey));
      void queryClient.invalidateQueries({ queryKey: props.queryKey });
    },
    onError: ({ error }: { error: { serverError?: string } }) => {
      toast.error(t(error.serverError ?? 'campaigns.errors.startFailed'));
    },
  });

  const start = useAction(
    startCampaignAction,
    callbacks(
      props.status === 'paused'
        ? 'campaigns.detail.resumed'
        : 'campaigns.detail.started',
    ),
  );

  const pause = useAction(
    pauseCampaignAction,
    callbacks('campaigns.detail.paused'),
  );

  const pending = start.isPending || pause.isPending;

  if (props.status === 'draft' || props.status === 'paused') {
    return (
      <Button
        data-test={'campaign-start-button'}
        disabled={pending}
        onClick={() => start.execute({ campaignId: props.campaignId })}
      >
        <Play className={'w-4'} />

        <span>
          <Trans
            i18nKey={
              props.status === 'draft'
                ? 'campaigns.steps.discover.launch'
                : 'campaigns.detail.resume'
            }
          />
        </span>
      </Button>
    );
  }

  if (props.status === 'running') {
    return (
      <Button
        variant={'secondary'}
        data-test={'campaign-pause-button'}
        disabled={pending}
        onClick={() => pause.execute({ campaignId: props.campaignId })}
      >
        <Pause className={'w-4'} />

        <span>
          <Trans i18nKey={'campaigns.detail.pause'} />
        </span>
      </Button>
    );
  }

  return null;
}

function ProgressCard({
  live,
  children,
}: React.PropsWithChildren<{ live: CampaignLive }>) {
  const format = useFormatter();
  const locale = useLocale();
  const { progress } = live;

  const percent =
    progress.searchesTotal > 0
      ? Math.min(
          100,
          Math.round((progress.searchesDone / progress.searchesTotal) * 100),
        )
      : 0;

  return (
    <Card data-test={'campaign-progress'}>
      <CardHeader>
        <div
          className={
            'flex flex-col gap-3 md:flex-row md:items-start md:justify-between'
          }
        >
          <div className={'flex flex-col gap-1.5'}>
            <CardTitle className={'flex items-center gap-3'}>
              <Trans i18nKey={'campaigns.steps.discover.title'} />
              <CampaignStatusBadge status={live.status} />
            </CardTitle>

            <CardDescription>
              <Trans
                i18nKey={
                  live.status === 'running'
                    ? 'campaigns.detail.progressLive'
                    : live.status === 'draft'
                      ? 'campaigns.detail.progressDraft'
                      : 'campaigns.detail.progressDescription'
                }
              />
            </CardDescription>
          </div>

          {children}
        </div>
      </CardHeader>

      <CardContent className={'flex flex-col gap-6'}>
        <div className={'flex flex-col gap-2'}>
          <div className={'flex items-center justify-between text-sm'}>
            <span>
              <Trans
                i18nKey={'campaigns.detail.searchesProgress'}
                values={{
                  done: progress.searchesDone,
                  total: progress.searchesTotal,
                }}
              />
            </span>

            <span className={'text-muted-foreground tabular-nums'}>
              {percent} %
            </span>
          </div>

          <Progress value={percent} locale={locale} />
        </div>

        <dl
          className={
            'grid grid-cols-2 gap-4 text-sm md:grid-cols-3 lg:grid-cols-5'
          }
        >
          <Stat
            label={'campaigns.detail.prospectsFound'}
            value={format.number(progress.prospects)}
            highlight
          />

          <Stat
            label={'campaigns.detail.citiesAndCategories'}
            value={`${format.number(progress.zones)} × ${format.number(progress.categories)}`}
          />

          <Stat
            label={'campaigns.detail.productiveCategories'}
            value={format.number(progress.productive)}
            hint={'campaigns.detail.productiveHint'}
          />

          <Stat
            label={'campaigns.detail.abandonedCategories'}
            value={format.number(progress.abandoned)}
            hint={'campaigns.detail.abandonedHint'}
          />

          <PricingStat live={live} />

          <Stat
            label={'campaigns.detail.lastActivity'}
            value={
              progress.lastSearchAt ? (
                <LocalDateTime
                  value={progress.lastSearchAt}
                  dateStyle={'short'}
                  timeStyle={'short'}
                />
              ) : (
                '–'
              )
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * Tarif en crédits de prospection par prospect (roadmap n°13) : figé au lancement, sinon celui de la
 * dernière estimation (terminée ou en cours de mesure), sinon mesuré au lancement. Depuis le 4/11/2026 la
 * campagne part sans attendre : pendant la mesure, 1 crédit par prospect.
 */
function PricingStat({ live }: { live: CampaignLive }) {
  const { pricing } = live;
  const rate =
    pricing.rate === null ? null : Math.round(pricing.rate * 1000) / 10;

  if (pricing.creditsPerProspect !== null) {
    return (
      <Stat
        label={'campaigns.detail.pricingTitle'}
        value={
          <span data-test={'campaign-pricing'}>
            <Trans
              i18nKey={'campaigns.detail.pricingValue'}
              values={{ count: pricing.creditsPerProspect }}
            />
          </span>
        }
        hint={
          <Trans
            i18nKey={
              pricing.frozen
                ? rate === null
                  ? 'campaigns.detail.pricingFrozenHintNoRate'
                  : 'campaigns.detail.pricingFrozenHint'
                : 'campaigns.detail.pricingPreviewHint'
            }
            values={{ rate: rate ?? 0 }}
          />
        }
      />
    );
  }

  if (pricing.estimateStatus === 'running') {
    return (
      <Stat
        label={'campaigns.detail.pricingTitle'}
        value={
          <span
            className={'flex items-center gap-2 text-base'}
            data-test={'campaign-pricing-measuring'}
          >
            <Spinner className={'size-4'} />
            <Trans
              i18nKey={'campaigns.detail.pricingMeasuring'}
              values={{
                done: pricing.doneSearches,
                total: pricing.sampleSearches,
              }}
            />
          </span>
        }
        hint={
          <Trans
            i18nKey={
              pricing.frozen
                ? 'campaigns.detail.pricingMeasuringLaunchedHint'
                : 'campaigns.detail.pricingMeasuringHint'
            }
          />
        }
      />
    );
  }

  return (
    <Stat
      label={'campaigns.detail.pricingTitle'}
      value={
        <span className={'text-base'} data-test={'campaign-pricing-unknown'}>
          <Trans i18nKey={'campaigns.detail.pricingUnknown'} />
        </span>
      }
      hint={<Trans i18nKey={'campaigns.detail.pricingUnknownHint'} />}
    />
  );
}

function Stat(props: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={'flex flex-col gap-1'}>
      <dt className={'text-muted-foreground text-xs'}>
        <Trans i18nKey={props.label} />
      </dt>

      <dd
        className={
          props.highlight
            ? 'font-heading text-2xl font-normal tracking-[-0.02em] tabular-nums'
            : 'text-lg font-medium tabular-nums'
        }
      >
        {props.value}
      </dd>

      {props.hint ? (
        <p className={'text-muted-foreground text-xs'}>
          {typeof props.hint === 'string' ? (
            <Trans i18nKey={props.hint} />
          ) : (
            props.hint
          )}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Affichage en direct : chaque prospect trouvé, chaque recherche terminée et chaque changement de
 * statut relancent la lecture de la campagne (au plus une fois par seconde). Le rafraîchissement
 * périodique reste en filet de sécurité si la connexion temps réel tombe.
 *
 * useEffect justifié : un abonnement temps réel doit être ouvert au montage et fermé au démontage.
 */
function useCampaignRealtime(campaignId: string, queryKey: unknown[]) {
  const client = useSupabase();
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (timer) {
        return;
      }

      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey });
      }, 1000);
    };

    const channel = client
      .channel(`lm-campaign-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lm_prospects',
          filter: `campaign_id=eq.${campaignId}`,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'lm_campaign_categories',
          filter: `campaign_id=eq.${campaignId}`,
        },
        refresh,
      )
      .subscribe();

    return () => {
      if (timer) {
        clearTimeout(timer);
      }

      void client.removeChannel(channel);
    };
    // queryKey est recréé à chaque rendu : l'identifiant de campagne suffit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, campaignId, queryClient]);
}
