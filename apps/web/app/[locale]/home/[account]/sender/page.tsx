/**
 * Rôle : page « Expéditeurs » : liste des expéditeurs de l'organisation et formulaire de l'expéditeur choisi.
 * Données : loadSenders (sender.loader) et leadmaker.loader.
 * Écritures : aucune ici (actions dans les composants).
 */

import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadSpaces,
} from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { FolderSwitch } from './_components/folder-switch';
import { SendersWorkspace } from './_components/senders-workspace';
import { CIVILITIES } from './_lib/schema/sender-profile.schema';
import { senderLabel } from './_lib/sender-label';
import { loadSenders } from './_lib/server/sender.loader';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface SenderPageProps {
  params: Promise<{ account: string }>;
  searchParams: SearchParams;
}

export const generateMetadata = async () => {
  const t = await getTranslations('outreach');

  return {
    title: t('sender.pageTitle'),
  };
};

function SenderPage({ params, searchParams }: SenderPageProps) {
  return (
    <PageBody>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <SenderPageHeader params={params} />
      </Suspense>

      <div className={'flex w-full max-w-4xl flex-col pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <CardSkeleton rows={6} />
            </Delayed>
          }
        >
          <SenderContent params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageBody>
  );
}

export default SenderPage;

async function SenderPageHeader({
  params,
}: {
  params: SenderPageProps['params'];
}) {
  const { account } = await params;

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'common.routes.sender'} />}
      description={<AppBreadcrumbs />}
    />
  );
}

async function SenderContent(props: SenderPageProps) {
  const [{ account: slug }, rawSearchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();

  const [spaces, countries] = await Promise.all([
    loadSpaces(client, account.id),
    loadCountryOptions(client),
  ]);

  const requested =
    typeof rawSearchParams.space === 'string' ? rawSearchParams.space : null;

  const space = spaces.find((item) => item.id === requested) ?? spaces[0]!;
  const senders = await loadSenders(client, space.id);

  // ?sender=new : nouvel expéditeur ; ?sender=<id> : celui-là ; sinon celui par défaut (choix ensuite sur place)
  const requestedSender =
    typeof rawSearchParams.sender === 'string' ? rawSearchParams.sender : null;

  const valuesOf = (profile: (typeof senders)[number] | null) => {
    const civility = CIVILITIES.find((value) => value === profile?.civility);

    return {
      civility: civility ?? ('' as const),
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
      jobTitle: profile?.job_title ?? '',
      company: profile?.company ?? '',
      email: profile?.email ?? '',
      phone: profile?.phone ?? '',
      website: profile?.website ?? '',
      address: profile?.address ?? '',
      zip: profile?.zip ?? '',
      city: profile?.city ?? '',
      countryCode: profile?.country_code ?? '',
    };
  };

  const basePath = pathsConfig.app.accountSender.replace('[account]', slug);

  return (
    <div className={'flex flex-col gap-4'}>
      {senders.length > 0 ? null : (
        <Alert className={alertExtras.warning} data-test={'sender-missing'}>
          <AlertTitle>
            <Trans i18nKey={'outreach.sender.missingTitle'} />
          </AlertTitle>

          <AlertDescription>
            <Trans i18nKey={'outreach.sender.missingDescription'} />
          </AlertDescription>
        </Alert>
      )}

      <SendersWorkspace
        // autre dossier, ou nouvel expéditeur enregistré (l'action renvoie vers ?sender=<id>) : on repart de là
        key={`${space.id}:${requestedSender ?? ''}`}
        senders={senders.map((sender) => ({
          id: sender.id,
          first_name: sender.first_name,
          last_name: sender.last_name,
          company: sender.company,
          email: sender.email,
          is_default: sender.is_default,
          label: senderLabel(sender),
          defaultValues: valuesOf(sender),
        }))}
        initialSelected={requestedSender}
        emptyValues={valuesOf(null)}
        accountId={account.id}
        accountSlug={slug}
        spaceId={space.id}
        countries={countries}
        folderSwitch={
          spaces.length > 1 ? (
            <div className={'flex flex-col gap-1.5'}>
              <span className={'text-sm font-medium'}>
                <Trans i18nKey={'outreach.sender.folderLabel'} />
              </span>

              <FolderSwitch
                basePath={basePath}
                folders={spaces.map(({ id, label }) => ({ id, label }))}
                value={space.id}
              />
            </div>
          ) : null
        }
      />
    </div>
  );
}
