import { Suspense } from 'react';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import * as z from 'zod';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Button } from '@kit/ui/button';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';
import { parseTemplates } from '~/lib/leadmaker/templates';

import { TeamAccountLayoutPageHeader } from '../../../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../../../_lib/server/team-account-workspace.loader';
import { loadSenderProfile } from '../../../sender/_lib/server/sender.loader';
import { CampaignMessagesForm } from '../../_components/campaign-messages-form';
import {
  loadCampaign,
  loadPreviewProspects,
} from '../../_lib/server/campaigns.loader';

interface MessagesPageProps {
  params: Promise<{ account: string; id: string }>;
}

export const generateMetadata = async () => {
  const t = await getTranslations('outreach');

  return {
    title: t('messages.pageTitle'),
  };
};

function MessagesPage({ params }: MessagesPageProps) {
  return (
    <PageBody>
      <Suspense
        fallback={
          <>
            <PageHeaderSkeleton />

            <Delayed>
              <CardSkeleton rows={6} />
            </Delayed>
          </>
        }
      >
        <MessagesContent params={params} />
      </Suspense>
    </PageBody>
  );
}

export default MessagesPage;

async function MessagesContent({ params }: MessagesPageProps) {
  const { account: slug, id } = await params;

  if (!z.string().uuid().safeParse(id).success) {
    notFound();
  }

  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();
  const campaign = await loadCampaign(client, id);

  if (!campaign) {
    notFound();
  }

  const [sender, prospects] = await Promise.all([
    loadSenderProfile(client, campaign.space_id),
    loadPreviewProspects(client, campaign.space_id),
  ]);

  const campaignHref = `${pathsConfig.app.accountCampaigns.replace('[account]', slug)}/${id}`;
  const senderHref = `${pathsConfig.app.accountSender.replace('[account]', slug)}?space=${campaign.space_id}`;

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={campaign.name}
        description={<AppBreadcrumbs values={{ [id]: campaign.name }} />}
      >
        <Button
          variant={'outline'}
          size={'sm'}
          nativeButton={false}
          data-test={'messages-back-link'}
          render={<Link href={campaignHref} />}
        >
          <ArrowLeft className={'w-4'} />

          <span>
            <Trans i18nKey={'outreach.messages.backToCampaign'} />
          </span>
        </Button>
      </TeamAccountLayoutPageHeader>

      <div className={'flex w-full max-w-4xl flex-col pb-32'}>
        <CampaignMessagesForm
          accountId={account.id}
          campaignId={id}
          templates={parseTemplates(campaign.templates)}
          sender={
            sender
              ? {
                  first_name: sender.first_name,
                  last_name: sender.last_name,
                  company: sender.company,
                  email: sender.email,
                  phone: sender.phone,
                  website: sender.website,
                }
              : null
          }
          senderHref={senderHref}
          prospects={prospects}
        />
      </div>
    </>
  );
}
