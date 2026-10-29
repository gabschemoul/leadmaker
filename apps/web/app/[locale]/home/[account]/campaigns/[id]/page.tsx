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

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import { loadCountryOptions } from '../../_lib/server/leadmaker.loader';
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
  await loadTeamWorkspace(slug);

  const client = getSupabaseServerClient();

  const [campaign, countries] = await Promise.all([
    loadCampaign(client, id),
    loadCountryOptions(client),
  ]);

  if (!campaign) {
    notFound();
  }

  const live = await fetchCampaignLive(client, id);

  const countryLabel =
    countries.find((country) => country.code === campaign.country_code)
      ?.label ?? campaign.country_code;

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={campaign.name}
        description={<AppBreadcrumbs values={{ [id]: campaign.name }} />}
      />

      <CampaignDetailView
        campaignId={id}
        spaceName={campaign.space?.name ?? ''}
        countryLabel={countryLabel}
        billingPath={pathsConfig.app.accountBilling.replace('[account]', slug)}
        initialData={live}
      />
    </>
  );
}
