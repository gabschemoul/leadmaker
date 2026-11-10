import { Suspense } from 'react';

import { connection } from 'next/server';

import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { TeamAccountSettingsContainer } from '@kit/team-accounts/components';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
import { Trans } from '@kit/ui/trans';

import { CardLoading } from '~/components/skeletons/card-loading';
import featuresFlagConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';

import { loadSpaces } from '../_lib/server/leadmaker.loader';
import { FolderSwitch } from '../sender/_components/folder-switch';
import { SpaceOfferForm } from './_components/space-offer-form';

export const generateMetadata = async () => {
  const t = await getTranslations('teams');
  const title = t('settings.pageTitle');

  return {
    title,
  };
};

interface TeamAccountSettingsPageProps {
  params: Promise<{ account: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const paths = {
  teamAccountSettings: pathsConfig.app.accountSettings,
};

function TeamAccountSettingsPage(props: TeamAccountSettingsPageProps) {
  return (
    <div className={'flex w-full flex-1 flex-col gap-8 pb-16'}>
      <Suspense
        fallback={
          <CardLoading
            titleKey={'teams.settings.offer.title'}
            descriptionKey={'teams.settings.offer.description'}
            content={'area'}
          />
        }
      >
        <SpaceOfferCard
          params={props.params}
          searchParams={props.searchParams}
        />
      </Suspense>

      <Suspense
        fallback={
          <div className={'flex flex-col gap-8'}>
            <CardLoading
              titleKey={'teams.settings.teamLogo'}
              descriptionKey={'teams.settings.teamLogoDescription'}
            >
              <Skeleton className={'size-20 rounded-full'} />
            </CardLoading>

            <CardLoading
              titleKey={'teams.settings.teamName'}
              descriptionKey={'teams.settings.teamNameDescription'}
              content={'fields'}
              rows={1}
            />
          </div>
        }
      >
        <TeamAccountSettings params={props.params} />
      </Suspense>
    </div>
  );
}

async function TeamAccountSettings({
  params,
}: {
  params: TeamAccountSettingsPageProps['params'];
}) {
  await connection();

  const api = createTeamAccountsApi(getSupabaseServerClient());
  const slug = (await params).account;
  const data = await api.getTeamAccount(slug);

  const account = {
    id: data.id,
    name: data.name,
    pictureUrl: data.picture_url,
    slug: data.slug as string,
    primaryOwnerUserId: data.primary_owner_user_id,
  };

  const features = {
    enableTeamDeletion: featuresFlagConfig.enableTeamDeletion,
  };

  return (
    <TeamAccountSettingsContainer
      account={account}
      paths={paths}
      features={features}
    />
  );
}

/**
 * « Votre offre » (CDC-PARCOURS-TRI-ANNUAIRE §3.1) : texte du dossier utilisé par le tri IA et « Proposer avec
 * l'IA ». Choix du dossier (?space=) seulement quand l'organisation en a plusieurs, comme la page Expéditeurs.
 */
async function SpaceOfferCard(props: TeamAccountSettingsPageProps) {
  await connection();

  const [{ account: slug }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  const client = getSupabaseServerClient();
  const team = await createTeamAccountsApi(client).getTeamAccount(slug);
  const spaces = await loadSpaces(client, team.id);

  const requested =
    typeof searchParams.space === 'string' ? searchParams.space : null;

  const space = spaces.find((item) => item.id === requested) ?? spaces[0];

  if (!space) {
    return null;
  }

  const { data, error } = await client
    .from('lm_spaces')
    .select('offer')
    .eq('id', space.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (
    <Card data-test={'space-offer-card'}>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey={'teams.settings.offer.title'} />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey={'teams.settings.offer.description'} />
        </CardDescription>

        {spaces.length > 1 ? (
          <div className={'flex flex-col gap-1.5 pt-2'}>
            <span className={'text-muted-foreground text-xs'}>
              <Trans i18nKey={'outreach.sender.folderLabel'} />
            </span>

            <FolderSwitch
              basePath={pathsConfig.app.accountSettings.replace(
                '[account]',
                slug,
              )}
              folders={spaces.map(({ id, label }) => ({ id, label }))}
              value={space.id}
            />
          </div>
        ) : null}
      </CardHeader>

      <CardContent>
        <SpaceOfferForm
          key={space.id}
          spaceId={space.id}
          offer={data?.offer ?? ''}
        />
      </CardContent>
    </Card>
  );
}

export default TeamAccountSettingsPage;
