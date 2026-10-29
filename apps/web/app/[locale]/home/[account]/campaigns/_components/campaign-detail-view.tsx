'use client';

import { useEffect, useSyncExternalStore } from 'react';

import Link from 'next/link';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pause, Play, TriangleAlert } from 'lucide-react';
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
import { Trans } from '@kit/ui/trans';

import { CampaignStatusBadge } from '../../_components/leadmaker/campaign-status-badge';
import { ProspectsTable } from '../../_components/leadmaker/prospects-table';
import { type CampaignLive, fetchCampaignLive } from '../_lib/campaign-live';
import {
  pauseCampaignAction,
  startCampaignAction,
} from '../_lib/server/server-actions';

const REFRESH_INTERVAL = 10_000;

export function CampaignDetailView(props: {
  campaignId: string;
  folderName: string | null;
  countryLabel: string;
  billingPath: string;
  initialData: CampaignLive;
}) {
  const client = useSupabase();
  const queryKey = ['lm-campaign-live', props.campaignId];

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchCampaignLive(client, props.campaignId),
    initialData: props.initialData,
    staleTime: 5_000,
    // filet de sécurité : le temps réel (useCampaignRealtime) rafraîchit dès qu'il se passe quelque chose
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? REFRESH_INTERVAL : false,
  });

  useCampaignRealtime(props.campaignId, queryKey);

  const exportHref = `/api/leadmaker/export?campaign_id=${props.campaignId}`;
  const noCredits =
    data.status === 'paused' && data.pausedReason === 'no_credits';

  return (
    <div className={'flex flex-col gap-6 pb-32'}>
      <div
        className={
          'flex flex-col gap-4 md:flex-row md:items-center md:justify-between'
        }
      >
        <div
          className={
            'text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'
          }
        >
          <CampaignStatusBadge status={data.status} />

          {props.folderName ? (
            <span data-test={'campaign-folder'}>
              <Trans i18nKey={'campaigns.detail.folder'} />{' '}
              <span className={'text-foreground'}>{props.folderName}</span>
            </span>
          ) : null}

          <span>
            <Trans i18nKey={'campaigns.detail.country'} />{' '}
            <span className={'text-foreground'}>{props.countryLabel}</span>
          </span>
        </div>

        <div className={'flex flex-wrap gap-2'}>
          <CampaignActions
            campaignId={props.campaignId}
            status={data.status}
            queryKey={queryKey}
          />

          <Button
            variant={'outline'}
            nativeButton={false}
            data-test={'campaign-export-button'}
            render={<a href={exportHref} download />}
          >
            <Download className={'w-4'} />

            <span>
              <Trans i18nKey={'campaigns.export.button'} />
            </span>
          </Button>
        </div>
      </div>

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

      <ProgressCard live={data} />

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'campaigns.detail.latestProspectsTitle'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'campaigns.detail.latestProspectsDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          {data.prospects.length === 0 ? (
            <p className={'text-muted-foreground py-6 text-center text-sm'}>
              <Trans i18nKey={'campaigns.detail.noProspects'} />
            </p>
          ) : (
            <ProspectsTable prospects={data.prospects} />
          )}
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
                ? 'campaigns.detail.start'
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

function ProgressCard({ live }: { live: CampaignLive }) {
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
        <CardTitle>
          <Trans i18nKey={'campaigns.detail.progressTitle'} />
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

        <dl className={'grid grid-cols-2 gap-4 text-sm md:grid-cols-4'}>
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
            label={'campaigns.detail.abandonedCategories'}
            value={format.number(progress.abandoned)}
            hint={'campaigns.detail.abandonedHint'}
          />

          <Stat
            label={'campaigns.detail.lastActivity'}
            value={
              progress.lastSearchAt ? (
                <LocalDateTime value={progress.lastSearchAt} />
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

function Stat(props: {
  label: string;
  value: React.ReactNode;
  hint?: string;
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
            ? 'text-2xl font-semibold tabular-nums'
            : 'text-lg font-medium tabular-nums'
        }
      >
        {props.value}
      </dd>

      {props.hint ? (
        <p className={'text-muted-foreground text-xs'}>
          <Trans i18nKey={props.hint} />
        </p>
      ) : null}
    </div>
  );
}

const subscribeNoop = () => () => {};

/**
 * Date et heure dans le fuseau du navigateur. Le serveur ne connaît pas ce
 * fuseau : il rend en UTC, puis le navigateur réaffiche l'heure locale juste
 * après l'hydratation.
 */
function LocalDateTime(props: { value: string }) {
  const format = useFormatter();

  const timeZone = useSyncExternalStore(
    subscribeNoop,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => 'UTC',
  );

  return (
    <>
      {format.dateTime(new Date(props.value), {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone,
      })}
    </>
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
