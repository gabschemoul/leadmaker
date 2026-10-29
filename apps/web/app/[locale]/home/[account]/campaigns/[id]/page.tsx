import { Suspense } from 'react';

import { notFound } from 'next/navigation';

import { getTranslations } from 'next-intl/server';
import * as z from 'zod';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';
import { buildProspectsHref } from '~/lib/leadmaker/prospects-query';
import { parseTemplates, usableMessages } from '~/lib/leadmaker/templates';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadSpaces,
} from '../../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { CampaignDetailView } from '../_components/campaign-detail-view';
import { fetchCampaignLive } from '../_lib/campaign-live';
import { loadCampaign } from '../_lib/server/campaigns.loader';

interface CampaignPageProps {
  params: Promise<{ account: string; id: string }>;
}

type Params = CampaignPageProps['params'];

export const generateMetadata = async () => {
  const t = await getTranslations('campaigns');

  return {
    title: t('detail.pageTitle'),
  };
};

/**
 * L'en-tête porte le nom de la campagne : il attend donc les mêmes données
 * que le contenu et partage sa frontière.
 */
function CampaignPage({ params }: CampaignPageProps) {
  return (
    <PageBody>
      <Suspense
        fallback={
          <>
            <PageHeaderSkeleton />

            <Delayed className={'flex flex-col gap-6'}>
              <CardSkeleton rows={3} />
              <CardSkeleton rows={6} />
            </Delayed>
          </>
        }
      >
        <CampaignContent params={params} />
      </Suspense>
    </PageBody>
  );
}

export default CampaignPage;

async function CampaignContent({ params }: { params: Params }) {
  const { account: slug, id } = await params;

  if (!z.string().uuid().safeParse(id).success) {
    notFound();
  }

  // vérifie l'appartenance à l'organisation (et redirige sinon)
  const { account } = await loadTeamWorkspace(slug);

  const client = getSupabaseServerClient();

  const [campaign, countries, spaces] = await Promise.all([
    loadCampaign(client, id),
    loadCountryOptions(client),
    loadSpaces(client, account.id),
  ]);

  if (!campaign) {
    notFound();
  }

  const live = await fetchCampaignLive(client, id);

  const countryLabel =
    countries.find((country) => country.code === campaign.country_code)
      ?.label ?? campaign.country_code;

  // le dossier client n'est mentionné que si l'organisation en a plusieurs
  const folderName =
    spaces.length > 1
      ? (spaces.find((space) => space.id === campaign.space_id)?.label ?? null)
      : null;

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={campaign.name}
        description={<AppBreadcrumbs values={{ [id]: campaign.name }} />}
      />

      <CampaignDetailView
        campaignId={id}
        accountId={account.id}
        campaignsPath={pathsConfig.app.accountCampaigns.replace(
          '[account]',
          slug,
        )}
        allProspectsHref={buildProspectsHref(
          pathsConfig.app.accountProspects.replace('[account]', slug),
          {
            space: spaces.length > 1 ? campaign.space_id : undefined,
            filters: { campaign: id, status: 'all' },
          },
        )}
        canDelete={account.permissions.includes('settings.manage')}
        folderName={folderName}
        countryLabel={countryLabel}
        billingPath={pathsConfig.app.accountBilling.replace('[account]', slug)}
        messagesHref={`${pathsConfig.app.accountCampaigns.replace('[account]', slug)}/${id}/messages`}
        messagesCount={
          usableMessages(parseTemplates(campaign.templates)).length
        }
        initialData={live}
      />
    </>
  );
}
