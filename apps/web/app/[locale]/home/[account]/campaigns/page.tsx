/**
 * Rôle : page liste des campagnes de l'organisation (par dossier client), dans la charte du site
 * (relooking du 8/11/2026) : pastilles de statut, recherche en pilule, tableau dans un panneau blanc
 * avec en-têtes en petites capitales, lignes de 56 px avec titre et sous-titre, flèche discrète à droite.
 * Données : loadCampaigns (campaigns.loader) et leadmaker.loader. Filtres : ?q= (texte) et ?statut=, appliqués
 * dans le navigateur (CampaignsTable, instantané depuis le 10/11/2026).
 * Écritures : aucune.
 */

import { Suspense } from 'react';

import Link from 'next/link';

import { Plus, Radar, Search, Send, Target } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Button } from '@kit/ui/button';
import { buttonExtras } from '@kit/ui/button-extras';
import { PageBody } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import pathsConfig from '~/config/paths.config';
import type { Database } from '~/lib/database.types';

import { EmptyPanel } from '../_components/leadmaker/empty-panel';
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadSpaces,
} from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import {
  CampaignsTable,
  CampaignsTableLoading,
} from './_components/campaigns-table';
import { loadCampaigns } from './_lib/server/campaigns.loader';
import { STATUS_FILTERS } from './_lib/status-filters';

type CampaignStatus = Database['public']['Enums']['lm_campaign_status'];

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
      {/* titre fixe tout de suite ; seul le bouton attend l'adresse de l'organisation */}
      <TeamAccountLayoutPageHeader
        title={<Trans i18nKey={'common.routes.campaigns'} />}
      >
        <Suspense fallback={<Skeleton className={'h-9 w-44 rounded-full'} />}>
          <NewCampaignButton params={params} />
        </Suspense>
      </TeamAccountLayoutPageHeader>

      <div className={'flex w-full flex-col pb-32'}>
        <Suspense fallback={<CampaignsTableLoading />}>
          <CampaignsList params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageBody>
  );
}

export default CampaignsPage;

async function NewCampaignButton({ params }: { params: Params }) {
  const { account } = await params;

  const campaignsPath = pathsConfig.app.accountCampaigns.replace(
    '[account]',
    account,
  );

  return (
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
  );
}

async function CampaignsList({
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

  // un seul dossier (celui par défaut) : la notion n'est pas affichée
  const showFolders = spaces.length > 1;

  const folderLabel = (spaceId: string) =>
    spaces.find((space) => space.id === spaceId)?.label ?? '';

  const countryName = (code: string) =>
    countries.find((country) => country.code === code)?.label ?? code;

  if (allCampaigns.length === 0) {
    return (
      <div className={'py-6'} data-test={'campaigns-empty'}>
        <EmptyPanel
          icon={<Radar />}
          title={t('list.emptyTitle')}
          description={t('list.emptyDescription')}
          actions={
            <Button
              className={cn(buttonExtras.brand, buttonExtras.pill)}
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
    <CampaignsTable
      campaigns={allCampaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        createdLabel: `${t('list.createdAtColumn')} ${format.dateTime(
          new Date(campaign.createdAt),
          { dateStyle: 'medium' },
        )}`,
        folderLabel: folderLabel(campaign.spaceId),
        countryLabel: countryName(campaign.countryCode),
        prospectsLabel:
          campaign.prospects === null ? '' : format.number(campaign.prospects),
      }))}
      campaignsPath={campaignsPath}
      showFolders={showFolders}
      initialSearch={query.q ?? ''}
      initialStatus={activeStatus ?? null}
      searchPlaceholder={t('list.searchPlaceholder')}
      openLabel={t('list.open')}
    />
  );
}
