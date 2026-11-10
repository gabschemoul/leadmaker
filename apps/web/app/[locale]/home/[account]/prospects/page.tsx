/**
 * Rôle : page « Prospects » : liste paginée et filtrée des prospects d'un dossier client.
 * Données : loadProspectsPage / loadProspectFacets (prospects.loader), loadSpaces ; filtres lus dans l'URL au
 * premier affichage, puis appliqués sur place par ProspectsBrowser (instantané, 10/11/2026).
 * Écritures : aucune ici (actions dans ProspectsTable / ProspectsBulkActions).
 */

import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
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
  parseProspectsSearchParams,
} from '~/lib/leadmaker/prospects-query';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadSpaces } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { ImportProspectsDialog } from './_components/import-prospects-dialog';
import { ProspectsBrowser } from './_components/prospects-browser';
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
    <PageBody className={'max-w-[1600px]'}>
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

  const [{ prospects, total }, facets, campaigns] = await Promise.all([
    loadProspectsPage(client, {
      spaceId: space.id,
      page: state.page,
      sort: state.sort,
      dir: state.dir,
      filters: state.filters,
    }),
    loadProspectFacets(client, space.id),
    loadSpaceCampaigns(client, space.id),
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

  // campagnes archivées cachées (filtre et choix de campagne à la préparation),
  // sauf celle déjà choisie dans le filtre (lien gardé)
  const campaignOptions = campaigns
    .filter(
      (campaign) =>
        campaign.status !== 'archived' ||
        campaign.id === state.filters.campaign,
    )
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      total: campaignTotals.get(campaign.id) ?? 0,
    }));

  return (
    <ProspectsBrowser
      // autre dossier : tout repart de zéro
      key={space.id}
      basePath={basePath}
      initialState={state}
      spaceParam={spaceParam}
      spaceId={space.id}
      folders={folderOptions}
      campaigns={campaignOptions}
      categories={facets.categories}
      cities={facets.cities}
      initialProspects={prospects}
      initialTotal={total}
      accountId={account.id}
      campaignsPath={campaignsPath}
      formsHref={pathsConfig.app.accountForms.replace('[account]', slug)}
      canDelete={account.permissions.includes('settings.manage')}
      importDialog={
        <ImportProspectsDialog
          folders={folderOptions}
          defaultSpaceId={space.id}
        />
      }
    />
  );
}
