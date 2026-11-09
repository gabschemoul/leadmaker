import { Suspense } from 'react';

import { notFound } from 'next/navigation';

import { getLocale, getTranslations } from 'next-intl/server';
import * as z from 'zod';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';

import { TeamAccountLayoutPageHeader } from '../../../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadSpaces,
} from '../../../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../../../_lib/server/team-account-workspace.loader';
import { CampaignForm } from '../../_components/campaign-form';
import { campaignToFormValues } from '../../_lib/schema/campaign.schema';
import {
  loadCampaignForEdit,
  loadSpaceOffers,
} from '../../_lib/server/campaigns.loader';
import { getCategoryLimit } from '../../_lib/server/power-user';

interface EditCampaignPageProps {
  params: Promise<{ account: string; id: string }>;
}

type Params = EditCampaignPageProps['params'];

export const generateMetadata = async () => {
  const t = await getTranslations('campaigns');

  return {
    title: t('form.editPageTitle'),
  };
};

/**
 * Modification d'une campagne, même lancée. L'en-tête porte le nom de la
 * campagne : il partage la frontière du formulaire.
 */
function EditCampaignPage({ params }: EditCampaignPageProps) {
  return (
    <PageBody>
      <Suspense
        fallback={
          <>
            <PageHeaderSkeleton />

            <Delayed className={'flex max-w-3xl flex-col gap-6'}>
              <CardSkeleton rows={4} />
              <CardSkeleton rows={3} />
            </Delayed>
          </>
        }
      >
        <EditCampaignContent params={params} />
      </Suspense>
    </PageBody>
  );
}

export default EditCampaignPage;

async function EditCampaignContent({ params }: { params: Params }) {
  const { account: slug, id } = await params;

  if (!z.string().uuid().safeParse(id).success) {
    notFound();
  }

  const { account, user } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();
  const locale = await getLocale();

  const [campaign, spaces, spaceOffers, countries, categoryLimit] =
    await Promise.all([
      loadCampaignForEdit(client, id, locale),
      loadSpaces(client, account.id),
      loadSpaceOffers(client, account.id),
      loadCountryOptions(client),
      getCategoryLimit(user.id),
    ]);

  if (!campaign) {
    notFound();
  }

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={campaign.name}
        description={<AppBreadcrumbs values={{ [id]: campaign.name }} />}
      />

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
        campaign={{
          id: campaign.id,
          values: campaignToFormValues({
            ...campaign,
            offer: spaceOffers[campaign.space_id] ?? null,
          }),
          launched: campaign.launched,
        }}
      />
    </>
  );
}
