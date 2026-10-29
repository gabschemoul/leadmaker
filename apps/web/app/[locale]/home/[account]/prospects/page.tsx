import { Suspense } from 'react';

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import {
  Delayed,
  PageHeaderSkeleton,
  TableSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';
import {
  buildProspectsHref,
  countActiveFilters,
  parseProspectsSearchParams,
  toProspectsSearchParams,
} from '~/lib/leadmaker/prospects-query';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadSpaces } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { ImportProspectsDialog } from './_components/import-prospects-dialog';
import { ProspectsFilters } from './_components/prospects-filters';
import { ProspectsList } from './_components/prospects-list';
import {
  PROSPECTS_PAGE_SIZE,
  loadProspectFacets,
  loadProspectsPage,
  loadSpaceCampaigns,
} from './_lib/server/prospects.loader';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface ProspectsPageProps {
  params: Promise<{ account: string }>;
  searchParams: SearchParams;
}

export const generateMetadata = async () => {
  const t = await getTranslations('prospects');

  return {
    title: t('pageTitle'),
  };
};

function ProspectsPage({ params, searchParams }: ProspectsPageProps) {
  return (
    <PageBody>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <ProspectsPageHeader params={params} />
      </Suspense>

      <div className={'flex w-full flex-col pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <TableSkeleton rows={10} />
            </Delayed>
          }
        >
          <ProspectsContent params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageBody>
  );
}

export default ProspectsPage;

async function ProspectsPageHeader({
  params,
}: {
  params: ProspectsPageProps['params'];
}) {
  const { account } = await params;

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'common.routes.prospects'} />}
      description={<AppBreadcrumbs />}
    />
  );
}

async function ProspectsContent(props: ProspectsPageProps) {
  const [{ account: slug }, rawSearchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  const state = parseProspectsSearchParams(rawSearchParams);

  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();
  const spaces = await loadSpaces(client, account.id);

  // l'espace par défaut vient en premier ; avec un seul dossier client, la
  // notion reste invisible (pas de filtre, pas de paramètre d'URL)
  const showFolders = spaces.length > 1;
  const space = spaces.find((item) => item.id === state.space) ?? spaces[0]!;
  const spaceParam = showFolders ? space.id : undefined;

  const [{ prospects, total }, facets, campaigns, format] = await Promise.all([
    loadProspectsPage(client, {
      spaceId: space.id,
      page: state.page,
      sort: state.sort,
      dir: state.dir,
      filters: state.filters,
    }),
    loadProspectFacets(client, space.id),
    loadSpaceCampaigns(client, space.id),
    getFormatter(),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PROSPECTS_PAGE_SIZE));
  const basePath = pathsConfig.app.accountProspects.replace('[account]', slug);
  const campaignsPath = pathsConfig.app.accountCampaigns.replace(
    '[account]',
    slug,
  );

  const pageHref = (page: number) =>
    buildProspectsHref(basePath, { ...state, space: spaceParam, page });

  // page au-delà de la dernière (lien périmé) : on revient à la dernière
  if (prospects.length === 0 && state.page > pageCount) {
    redirect(pageHref(pageCount));
  }

  const folderOptions = showFolders
    ? spaces.map(({ id, label }) => ({ id, label }))
    : [];

  // nombre de prospects par campagne, pour le filtre
  const campaignTotals = new Map(
    facets.campaigns.map((facet) => [facet.value, facet.total]),
  );

  const campaignOptions = campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    total: campaignTotals.get(campaign.id) ?? 0,
  }));

  const exportParams = toProspectsSearchParams({ filters: state.filters });
  exportParams.set('space_id', space.id);

  const canDelete = account.permissions.includes('settings.manage');
  const hasFilters = countActiveFilters(state.filters) > 0;

  return (
    <Card>
      <CardHeader
        className={
          'flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between'
        }
      >
        <ProspectsFilters
          basePath={basePath}
          state={state}
          folders={folderOptions}
          spaceId={space.id}
          campaigns={campaignOptions}
          categories={facets.categories}
          cities={facets.cities}
        />

        <div className={'flex shrink-0 gap-2'}>
          <ImportProspectsDialog
            folders={folderOptions}
            defaultSpaceId={space.id}
          />

          <Button
            size={'sm'}
            variant={'outline'}
            nativeButton={false}
            data-test={'export-prospects-button'}
            render={
              <a
                href={`/api/leadmaker/export?${exportParams.toString()}`}
                download
              />
            }
          >
            <Download className={'w-4'} />

            <span>
              <Trans
                i18nKey={
                  hasFilters
                    ? 'prospects.export.filtered'
                    : 'prospects.export.all'
                }
              />
            </span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        <ProspectsList
          // nouvelle page, nouveau tri ou nouveaux filtres : la sélection repart de zéro
          key={pageHref(state.page)}
          basePath={basePath}
          state={state}
          space={spaceParam}
          prospects={prospects}
          accountId={account.id}
          campaignsPath={campaignsPath}
          canDelete={canDelete}
          campaigns={campaignOptions.map(({ id, name }) => ({ id, name }))}
          formsHref={pathsConfig.app.accountForms.replace('[account]', slug)}
          noResultsMessage={
            <span data-test={'prospects-empty'}>
              <Trans
                i18nKey={hasFilters ? 'prospects.noMatch' : 'prospects.empty'}
              />
            </span>
          }
        />

        <div
          className={
            'text-muted-foreground flex items-center justify-between text-sm'
          }
        >
          <span data-test={'prospects-total'}>
            <Trans
              i18nKey={'prospects.total'}
              values={{ count: total, formatted: format.number(total) }}
            />
          </span>

          {pageCount > 1 ? (
            <div className={'flex items-center gap-2'}>
              <PageLink
                href={state.page > 1 ? pageHref(state.page - 1) : null}
                dataTest={'prospects-previous-page'}
              >
                <ChevronLeft className={'w-4'} />

                <Trans i18nKey={'prospects.previousPage'} />
              </PageLink>

              <span className={'tabular-nums'}>
                <Trans
                  i18nKey={'prospects.pageOf'}
                  values={{ page: state.page, count: pageCount }}
                />
              </span>

              <PageLink
                href={state.page < pageCount ? pageHref(state.page + 1) : null}
                dataTest={'prospects-next-page'}
              >
                <Trans i18nKey={'prospects.nextPage'} />

                <ChevronRight className={'w-4'} />
              </PageLink>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PageLink(
  props: React.PropsWithChildren<{ href: string | null; dataTest: string }>,
) {
  if (!props.href) {
    return (
      <Button size={'sm'} variant={'outline'} disabled>
        {props.children}
      </Button>
    );
  }

  return (
    <Button
      size={'sm'}
      variant={'outline'}
      nativeButton={false}
      data-test={props.dataTest}
      render={<Link href={props.href} />}
    >
      {props.children}
    </Button>
  );
}
