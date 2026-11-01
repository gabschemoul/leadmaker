import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { CardSkeleton, Delayed } from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';

import { DashboardNextActions } from './_components/dashboard-next-actions';
import { TeamAccountLayoutPageHeader } from './_components/team-account-layout-page-header';
import { loadDashboard } from './_lib/server/dashboard.loader';
import { loadTeamWorkspace } from './_lib/server/team-account-workspace.loader';

interface TeamAccountHomePageProps {
  params: Promise<{ account: string }>;
}

export const generateMetadata = async () => {
  const t = await getTranslations('teams');
  const title = t('home.pageTitle');

  return {
    title,
  };
};

/** Le tableau de bord : les prochaines actions, campagne par campagne. */
function TeamAccountHomePage({ params }: TeamAccountHomePageProps) {
  return (
    <PageBody>
      <Suspense fallback={null}>
        <DashboardHeader params={params} />
      </Suspense>

      <Suspense
        fallback={
          <Delayed className={'flex flex-col gap-6'}>
            <CardSkeleton rows={1} />
            <CardSkeleton rows={4} />
          </Delayed>
        }
      >
        <DashboardContent params={params} />
      </Suspense>
    </PageBody>
  );
}

export default TeamAccountHomePage;

async function DashboardHeader({ params }: TeamAccountHomePageProps) {
  const { account } = await params;

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'common.routes.dashboard'} />}
      description={<AppBreadcrumbs />}
    />
  );
}

async function DashboardContent({ params }: TeamAccountHomePageProps) {
  const { account: slug } = await params;
  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();
  const data = await loadDashboard(client, account.id);

  return (
    <DashboardNextActions
      data={data}
      campaignsPath={pathsConfig.app.accountCampaigns.replace(
        '[account]',
        slug,
      )}
      billingPath={pathsConfig.app.accountBilling.replace('[account]', slug)}
    />
  );
}
