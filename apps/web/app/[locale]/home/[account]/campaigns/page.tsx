/**
 * Rôle : page liste des campagnes de l'organisation (par dossier client).
 * Données : loadCampaigns (campaigns.loader) et leadmaker.loader.
 * Écritures : aucune.
 */

import { Suspense } from 'react';

import Link from 'next/link';

import { PlusCircle } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
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

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';

import { CampaignStatusBadge } from '../_components/leadmaker/campaign-status-badge';
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadSpaces,
} from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { loadCampaigns } from './_lib/server/campaigns.loader';

interface CampaignsPageProps {
  params: Promise<{ account: string }>;
  searchParams: Promise<{ archived?: string }>;
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

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'common.routes.campaigns'} />}
      description={<AppBreadcrumbs />}
    />
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
  // ?archived=1 : la liste des campagnes archivées (audit E18) ; sinon elles sont masquées
  const showArchived = (await searchParams).archived === '1';
  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();

  const [spaces, allCampaigns, countries, format] = await Promise.all([
    loadSpaces(client, account.id),
    loadCampaigns(client, account.id),
    loadCountryOptions(client),
    getFormatter(),
  ]);

  const campaignsPath = pathsConfig.app.accountCampaigns.replace(
    '[account]',
    slug,
  );

  const archivedCount = allCampaigns.filter(
    (campaign) => campaign.status === 'archived',
  ).length;

  const campaigns = allCampaigns.filter(
    (campaign) => (campaign.status === 'archived') === showArchived,
  );

  // un seul dossier (celui par défaut) : la notion n'est pas affichée
  const showFolders = spaces.length > 1;

  const folderLabel = (spaceId: string) =>
    spaces.find((space) => space.id === spaceId)?.label ?? '';

  const countryName = (code: string) =>
    countries.find((country) => country.code === code)?.label ?? code;

  return (
    <Card>
      <CardHeader className={'flex flex-row items-start justify-between'}>
        <div className={'flex flex-col space-y-1.5'}>
          <CardTitle>
            <Trans i18nKey={'campaigns.list.title'} />
          </CardTitle>

          <CardDescription>
            <Trans
              i18nKey={
                showArchived
                  ? 'campaigns.archive.listDescription'
                  : 'campaigns.list.description'
              }
            />
          </CardDescription>

          {showArchived || archivedCount > 0 ? (
            <Link
              className={'text-muted-foreground text-sm underline'}
              data-test={'campaigns-archived-toggle'}
              href={
                showArchived ? campaignsPath : `${campaignsPath}?archived=1`
              }
            >
              <Trans
                i18nKey={
                  showArchived
                    ? 'campaigns.archive.backToList'
                    : 'campaigns.archive.showArchived'
                }
                values={{ count: archivedCount }}
              />
            </Link>
          ) : null}
        </div>

        <Button
          size={'sm'}
          nativeButton={false}
          data-test={'new-campaign-button'}
          render={<Link href={`${campaignsPath}/new`} />}
        >
          <PlusCircle className={'w-4'} />

          <span>
            <Trans i18nKey={'campaigns.list.newButton'} />
          </span>
        </Button>
      </CardHeader>

      <CardContent>
        {campaigns.length === 0 ? (
          <p
            className={'text-muted-foreground py-6 text-center text-sm'}
            data-test={'campaigns-empty'}
          >
            <Trans
              i18nKey={
                showArchived
                  ? 'campaigns.archive.listEmpty'
                  : 'campaigns.list.empty'
              }
            />
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
              </TableRow>
            </TableHeader>

            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className={'font-medium'}>
                    <Link
                      className={'hover:underline'}
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
                    <TableCell>{folderLabel(campaign.spaceId)}</TableCell>
                  ) : null}

                  <TableCell>{countryName(campaign.countryCode)}</TableCell>

                  <TableCell className={'text-right tabular-nums'}>
                    {format.number(campaign.prospects)}
                  </TableCell>

                  <TableCell>
                    {format.dateTime(new Date(campaign.createdAt), {
                      dateStyle: 'medium',
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
