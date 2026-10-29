import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';

import { NoSpaceNotice } from '../../_components/leadmaker/no-space-notice';
import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadDiscoveryBalance,
  loadSpaces,
} from '../../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { CampaignForm } from '../_components/campaign-form';

interface NewCampaignPageProps {
  params: Promise<{ account: string }>;
}

type Params = NewCampaignPageProps['params'];

export const generateMetadata = async () => {
  const t = await getTranslations('campaigns');

  return {
    title: t('form.pageTitle'),
  };
};

function NewCampaignPage({ params }: NewCampaignPageProps) {
  return (
    <PageBody>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <NewCampaignPageHeader params={params} />
      </Suspense>

      <Suspense
        fallback={
          <Delayed className={'grid grid-cols-1 gap-6 lg:grid-cols-3'}>
            <div className={'flex flex-col gap-6 lg:col-span-2'}>
              <CardSkeleton rows={3} />
              <CardSkeleton rows={4} />
            </div>

            <CardSkeleton rows={4} />
          </Delayed>
        }
      >
        <NewCampaignContent params={params} />
      </Suspense>
    </PageBody>
  );
}

export default NewCampaignPage;

async function NewCampaignPageHeader({ params }: { params: Params }) {
  const { account } = await params;

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'campaigns.form.pageTitle'} />}
      description={<AppBreadcrumbs />}
    />
  );
}

async function NewCampaignContent({ params }: { params: Params }) {
  const { account: slug } = await params;
  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();

  const [spaces, countries, balance] = await Promise.all([
    loadSpaces(client, account.id),
    loadCountryOptions(client),
    loadDiscoveryBalance(client, account.id),
  ]);

  if (spaces.length === 0) {
    return <NoSpaceNotice account={slug} />;
  }

  return (
    <CampaignForm
      accountId={account.id}
      accountSlug={slug}
      spaces={spaces}
      countries={countries}
      discoveryBalance={balance}
    />
  );
}
