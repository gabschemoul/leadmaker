/**
 * Rôle : page liste des campagnes de l'organisation (par dossier client) — tableau façon Apollo
 * (relooking du 8/11/2026) : barre d'outils avec recherche et filtres par statut, lignes denses,
 * action dans la ligne, état vide qui explique la fonction.
 * Données : loadCampaigns (campaigns.loader) et leadmaker.loader. Filtres : ?q= (texte) et ?statut=.
 * Écritures : aucune.
 */

import { Suspense } from 'react';

import Link from 'next/link';

import { ArrowRight, Plus, Radar, Search, Send, Target } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { buttonExtras } from '@kit/ui/button-extras';
import { Card } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { PageBody } from '@kit/ui/page';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';
import type { Database } from '~/lib/database.types';

import { CampaignStatusBadge } from '../_components/leadmaker/campaign-status-badge';
import { EmptyPanel } from '../_components/leadmaker/empty-panel';
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadSpaces,
} from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { loadCampaigns } from './_lib/server/campaigns.loader';

type CampaignStatus = Database['public']['Enums']['lm_campaign_status'];

/** Filtres de statut proposés dans la barre d'outils, dans l'ordre d'affichage. */
const STATUS_FILTERS: CampaignStatus[] = [
  'running',
  'paused',
  'draft',
  'completed',
  'archived',
];

interface CampaignsPageProps {
  params: Promise<{ account: string }>;
  searchParams: Promise<{ archived?: string; statut?: string; q?: string }>;
}

type Params = CampaignsPageProps['params'];

export const generateMetadata = async () => {
  const t = await getTranslations('campaigns');

  return {
    title: t('list.pageTitle'),
  };
};

function CampaignsPage({ params, searchParams }: CampaignsPageProps) {
  return (
    <PageBody>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <CampaignsPageHeader params={params} />
      </Suspense>

      <div className={'flex w-full flex-col pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <CardSkeleton rows={5} />
            </Delayed>
          }
        >
          <CampaignsCard params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageBody>
  );
}

export default CampaignsPage;

async function CampaignsPageHeader({ params }: { params: Params }) {
  const { account } = await params;

  const campaignsPath = pathsConfig.app.accountCampaigns.replace(
    '[account]',
    account,
  );

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'common.routes.campaigns'} />}
    >
      <Button
        className={cn(buttonExtras.brand, buttonExtras.pill)}
        nativeButton={false}
        data-test={'new-campaign-button'}
        render={<Link href={`${campaignsPath}/new`} />}
      >
        <Plus className={'w-4'} />

        <span>
          <Trans i18nKey={'campaigns.list.newButton'} />
        </span>
      </Button>
    </TeamAccountLayoutPageHeader>
  );
}

async function CampaignsCard({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: CampaignsPageProps['searchParams'];
}) {
  const { account: slug } = await params;
  const query = await searchParams;
  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();

  const [spaces, allCampaigns, countries, format, t] = await Promise.all([
    loadSpaces(client, account.id),
    loadCampaigns(client, account.id),
    loadCountryOptions(client),
    getFormatter(),
    getTranslations('campaigns'),
  ]);

  const campaignsPath = pathsConfig.app.accountCampaigns.replace(
    '[account]',
    slug,
  );

  // ?archived=1 (ancien lien) vaut ?statut=archived
  const statusFilter = (query.archived === '1' ? 'archived' : query.statut) as
    | CampaignStatus
    | undefined;

  const activeStatus = STATUS_FILTERS.includes(statusFilter as CampaignStatus)
    ? statusFilter
    : undefined;

  const search = (query.q ?? '').trim().toLocaleLowerCase();

  const countByStatus = (status: CampaignStatus) =>
    allCampaigns.filter((campaign) => campaign.status === status).length;

  // sans filtre : tout sauf les archivées (comme avant)
  const byStatus = allCampaigns.filter((campaign) =>
    activeStatus
      ? campaign.status === activeStatus
      : campaign.status !== 'archived',
  );

  const campaigns = search
    ? byStatus.filter((campaign) =>
        campaign.name.toLocaleLowerCase().includes(search),
      )
    : byStatus;

  const visibleCount = allCampaigns.filter(
    (campaign) => campaign.status !== 'archived',
  ).length;

  // un seul dossier (celui par défaut) : la notion n'est pas affichée
  const showFolders = spaces.length > 1;

  const folderLabel = (spaceId: string) =>
    spaces.find((space) => space.id === spaceId)?.label ?? '';

  const countryName = (code: string) =>
    countries.find((country) => country.code === code)?.label ?? code;

  const filterHref = (status?: CampaignStatus) => {
    const params = new URLSearchParams();
    if (status) params.set('statut', status);
    if (search) params.set('q', query.q ?? '');
    const qs = params.toString();
    return qs ? `${campaignsPath}?${qs}` : campaignsPath;
  };

  const hasAny = allCampaigns.length > 0;

  if (!hasAny) {
    return (
      <div className={'py-6'} data-test={'campaigns-empty'}>
        <EmptyPanel
          icon={<Radar />}
          title={t('list.emptyTitle')}
          description={t('list.emptyDescription')}
          actions={
            <Button
              className={buttonExtras.brand}
              nativeButton={false}
              render={<Link href={`${campaignsPath}/new`} />}
            >
              <Plus className={'w-4'} />
              <span>{t('list.newButton')}</span>
            </Button>
          }
          features={[
            {
              icon: <Target />,
              title: t('list.featureTarget'),
              text: t('list.featureTargetText'),
            },
            {
              icon: <Search />,
              title: t('list.featureFind'),
              text: t('list.featureFindText'),
            },
            {
              icon: <Send />,
              title: t('list.featureContact'),
              text: t('list.featureContactText'),
            },
          ]}
        />
      </div>
    );
  }

  return (
    <Card className={'gap-0 py-0'}>
      {/* barre d'outils : recherche + filtres par statut */}
      <div
        className={
          'flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4'
        }
      >
        <form
          action={campaignsPath}
          method={'get'}
          className={'relative w-full sm:max-w-xs'}
          role={'search'}
        >
          {activeStatus ? (
            <input type={'hidden'} name={'statut'} value={activeStatus} />
          ) : null}

          <Search
            className={
              'text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
            }
          />

          <Input
            name={'q'}
            defaultValue={query.q ?? ''}
            placeholder={t('list.searchPlaceholder')}
            className={'h-8 pl-9'}
            data-test={'campaigns-search'}
          />
        </form>

        <div className={'flex flex-wrap items-center gap-1'}>
          <FilterChip
            href={filterHref()}
            active={!activeStatus}
            count={visibleCount}
            label={t('list.filterAll')}
            testId={'campaigns-filter-all'}
          />

          {STATUS_FILTERS.map((status) => (
            <FilterChip
              key={status}
              href={filterHref(status)}
              active={activeStatus === status}
              count={countByStatus(status)}
              label={t(`status.${status}`)}
              testId={
                status === 'archived'
                  ? 'campaigns-archived-toggle'
                  : `campaigns-filter-${status}`
              }
            />
          ))}
        </div>
      </div>

      {campaigns.length === 0 ? (
        <p
          className={'text-muted-foreground px-4 py-12 text-center text-sm'}
          data-test={'campaigns-empty'}
        >
          {activeStatus === 'archived' && !search
            ? t('archive.listEmpty')
            : t('list.emptyFiltered')}
        </p>
      ) : (
        <Table data-test={'campaigns-table'}>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans i18nKey={'campaigns.list.nameColumn'} />
              </TableHead>

              <TableHead>
                <Trans i18nKey={'campaigns.list.statusColumn'} />
              </TableHead>

              {showFolders ? (
                <TableHead>
                  <Trans i18nKey={'campaigns.list.folderColumn'} />
                </TableHead>
              ) : null}

              <TableHead>
                <Trans i18nKey={'campaigns.list.countryColumn'} />
              </TableHead>

              <TableHead className={'text-right'}>
                <Trans i18nKey={'campaigns.list.prospectsColumn'} />
              </TableHead>

              <TableHead>
                <Trans i18nKey={'campaigns.list.createdAtColumn'} />
              </TableHead>

              <TableHead className={'w-28'} />
            </TableRow>
          </TableHeader>

          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className={'max-w-[28rem] truncate font-medium'}>
                  <Link
                    className={'underline-offset-4 hover:underline'}
                    data-test={'campaign-link'}
                    href={`${campaignsPath}/${campaign.id}`}
                  >
                    {campaign.name}
                  </Link>
                </TableCell>

                <TableCell>
                  <CampaignStatusBadge status={campaign.status} />
                </TableCell>

                {showFolders ? (
                  <TableCell className={'text-muted-foreground'}>
                    {folderLabel(campaign.spaceId)}
                  </TableCell>
                ) : null}

                <TableCell className={'text-muted-foreground'}>
                  {countryName(campaign.countryCode)}
                </TableCell>

                <TableCell className={'text-right tabular-nums'}>
                  {format.number(campaign.prospects)}
                </TableCell>

                <TableCell className={'text-muted-foreground'}>
                  {format.dateTime(new Date(campaign.createdAt), {
                    dateStyle: 'medium',
                  })}
                </TableCell>

                <TableCell className={'text-right'}>
                  <Button
                    variant={'outline'}
                    size={'sm'}
                    nativeButton={false}
                    render={<Link href={`${campaignsPath}/${campaign.id}`} />}
                  >
                    <span>{t('list.open')}</span>
                    <ArrowRight />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div
        className={
          'text-muted-foreground flex items-center justify-between border-t px-4 py-2.5 text-[13px]'
        }
      >
        <span>{t('list.count', { count: campaigns.length })}</span>
      </div>
    </Card>
  );
}

function FilterChip(props: {
  href: string;
  active: boolean;
  count: number;
  label: string;
  testId: string;
}) {
  return (
    <Link
      href={props.href}
      aria-current={props.active ? 'page' : undefined}
      data-test={props.testId}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors',
        props.active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span>{props.label}</span>
      <Badge
        variant={'secondary'}
        className={cn(
          'h-4 min-w-4 px-1 text-[11px]',
          props.active && 'bg-background/20 text-background',
        )}
      >
        {props.count}
      </Badge>
    </Link>
  );
}
