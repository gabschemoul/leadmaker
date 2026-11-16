/**
 * Rôle : page « Prospects » : liste paginée et filtrée des prospects de toute l'organisation (tous espaces réunis).
 * Données : loadProspectsPage / loadProspectFacets (prospects.loader), loadSpaceIds ; filtres lus dans l'URL au
 * premier affichage, puis appliqués sur place par ProspectsBrowser (instantané, 10/11/2026).
 * Écritures : aucune ici (actions dans ProspectsTable / ProspectsBulkActions).
 */

import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { Delayed } from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';
import {
  buildProspectsHref,
  parseProspectsSearchParams,
} from '~/lib/leadmaker/prospects-query';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadSpaceIds } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { ImportProspectsDialog } from './_components/import-prospects-dialog';
import { ProspectsBrowser } from './_components/prospects-browser';
import { ProspectsSkeleton } from './_components/prospects-skeleton';
import {
  PROSPECTS_PAGE_SIZE,
  loadAccountCampaigns,
  loadProspectFacets,
  loadProspectsPage,
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
      {/* titre fixe : affiché tout de suite, sans attendre le serveur */}
      <TeamAccountLayoutPageHeader
        title={<Trans i18nKey={'common.routes.prospects'} />}
      />

      <div className={'flex w-full flex-col pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <ProspectsSkeleton />
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

async function ProspectsContent(props: ProspectsPageProps) {
  const [{ account: slug }, rawSearchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  const state = parseProspectsSearchParams(rawSearchParams);

  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();
  // l'espace par défaut en premier : les imports y vont
  const spaceIds = await loadSpaceIds(client, account.id);

  // compteurs des filtres (0,5 s sur 229 000 fiches) : lancés tout de suite mais pas attendus, les lignes
  // s'affichent sans eux ; les listes Activité / Ville se remplissent dès qu'ils arrivent
  const facets = loadProspectFacets(client, spaceIds).catch(() => ({
    categories: [],
    cities: [],
    campaigns: [],
  }));

  const [{ prospects, total }, campaigns] = await Promise.all([
    loadProspectsPage(client, {
      spaceIds,
      page: state.page,
      sort: state.sort,
      dir: state.dir,
      filters: state.filters,
    }),
    loadAccountCampaigns(client, account.id),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PROSPECTS_PAGE_SIZE));
  const basePath = pathsConfig.app.accountProspects.replace('[account]', slug);
  const campaignsPath = pathsConfig.app.accountCampaigns.replace(
    '[account]',
    slug,
  );

  const pageHref = (page: number) =>
    buildProspectsHref(basePath, { ...state, page });

  // page au-delà de la dernière (lien périmé) : on revient à la dernière
  if (prospects.length === 0 && state.page > pageCount) {
    redirect(pageHref(pageCount));
  }

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
    }));

  return (
    <ProspectsBrowser
      basePath={basePath}
      initialState={state}
      spaceIds={spaceIds}
      campaigns={campaignOptions}
      facets={facets}
      initialProspects={prospects}
      initialTotal={total}
      accountId={account.id}
      campaignsPath={campaignsPath}
      canDelete={account.permissions.includes('settings.manage')}
      importDialog={<ImportProspectsDialog defaultSpaceId={spaceIds[0]!} />}
    />
  );
}
