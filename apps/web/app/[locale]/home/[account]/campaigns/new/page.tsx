import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { CardSkeleton, Delayed } from '~/components/skeletons/page-skeletons';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadSpaces,
} from '../../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { CampaignForm } from '../_components/campaign-form';
import { loadSpaceOffers } from '../_lib/server/campaigns.loader';
import { getCategoryLimit } from '../_lib/server/power-user';

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
      {/* titre fixe : affiché tout de suite, sans attendre le serveur */}
      <TeamAccountLayoutPageHeader
        title={<Trans i18nKey={'campaigns.form.pageTitle'} />}
      />

      <Suspense
        fallback={
          <Delayed className={'flex w-full flex-col gap-6'}>
            <CardSkeleton rows={4} />
            <CardSkeleton rows={3} />
          </Delayed>
        }
      >
        <NewCampaignContent params={params} />
      </Suspense>
    </PageBody>
  );
}

export default NewCampaignPage;

async function NewCampaignContent({ params }: { params: Params }) {
  const { account: slug } = await params;
  const { account, user } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();

  const [spaces, spaceOffers, countries, categoryLimit] = await Promise.all([
    loadSpaces(client, account.id),
    loadSpaceOffers(client, account.id),
    loadCountryOptions(client),
    getCategoryLimit(user.id),
  ]);

  return (
    <CampaignForm
      accountId={account.id}
      accountSlug={slug}
      spaces={spaces.map(({ id, label, is_default }) => ({
        id,
        label,
        is_default,
      }))}
      spaceOffers={spaceOffers}
      countries={countries}
      categoryLimit={categoryLimit}
    />
  );
}
