/**
 * Rôle : page « Formulaires » (mode avancé) : formulaires préparés par statut, à vérifier et valider.
 * Données : loadAttempts / loadAttemptCounts (forms.loader), loadSpaces.
 * Écritures : aucune ici (actions dans FormsTable et AttemptDetailDialog).
 */

import { Suspense } from 'react';

import { Loader2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { Card, CardContent, CardDescription, CardHeader } from '@kit/ui/card';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { Delayed } from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';
import {
  ATTEMPT_GROUP_ORDER,
  type AttemptGroup,
  isAttemptGroup,
} from '~/lib/leadmaker/attempts';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadSpaces } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { FolderSwitch } from '../sender/_components/folder-switch';
import { FormsGroupsPanel } from './_components/forms-groups-panel';
import { FormsSkeleton } from './_components/forms-skeleton';
import { loadAttemptCounts, loadAttempts } from './_lib/server/forms.loader';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface FormsPageProps {
  params: Promise<{ account: string }>;
  searchParams: SearchParams;
}

export const generateMetadata = async () => {
  const t = await getTranslations('outreach');

  return {
    title: t('forms.pageTitle'),
  };
};

function FormsPage({ params, searchParams }: FormsPageProps) {
  return (
    <PageBody>
      {/* titre fixe : affiché tout de suite, sans attendre le serveur */}
      <TeamAccountLayoutPageHeader
        title={<Trans i18nKey={'common.routes.forms'} />}
      />

      <div className={'flex w-full flex-col pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <FormsSkeleton />
            </Delayed>
          }
        >
          <FormsContent params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageBody>
  );
}

export default FormsPage;

async function FormsContent(props: FormsPageProps) {
  const [{ account: slug }, rawSearchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();
  const spaces = await loadSpaces(client, account.id);

  const requestedSpace =
    typeof rawSearchParams.space === 'string' ? rawSearchParams.space : null;
  const space = spaces.find((item) => item.id === requestedSpace) ?? spaces[0]!;
  const showFolders = spaces.length > 1;

  // crédit unique (9/11) : les envois sont gratuits, plus de solde de prise de contact à afficher
  const counts = await loadAttemptCounts(client, space.id);

  // Sans onglet choisi : « Prêts », ou le premier onglet non vide (robot au
  // travail, formulaires à compléter…) pour ne jamais tomber sur une liste vide
  const group: AttemptGroup = isAttemptGroup(rawSearchParams.status)
    ? rawSearchParams.status
    : (ATTEMPT_GROUP_ORDER.find((item) => counts[item] > 0) ?? 'ready');

  const rows = await loadAttempts(client, { spaceId: space.id, group });

  const basePath = pathsConfig.app.accountForms.replace('[account]', slug);

  return (
    <Card>
      <CardHeader className={'flex flex-col gap-4'}>
        <CardDescription className={'max-w-2xl'}>
          <Trans i18nKey={'outreach.forms.intro'} />
        </CardDescription>

        {counts.preparing > 0 ? (
          <Alert data-test={'forms-preparing-banner'}>
            <Loader2 className={'h-4 animate-spin'} />

            <AlertDescription>
              <Trans
                i18nKey={'outreach.forms.preparingBanner'}
                values={{ count: counts.preparing }}
              />
            </AlertDescription>
          </Alert>
        ) : null}

        {showFolders ? (
          <div className={'flex flex-col gap-1.5'}>
            <span className={'text-sm font-medium'}>
              <Trans i18nKey={'outreach.forms.folderLabel'} />
            </span>

            <FolderSwitch
              basePath={basePath}
              folders={spaces.map(({ id, label }) => ({ id, label }))}
              value={space.id}
            />
          </div>
        ) : null}
      </CardHeader>

      <CardContent>
        <FormsGroupsPanel
          key={space.id}
          spaceId={space.id}
          accountId={account.id}
          counts={counts}
          initialGroup={group}
          initialRows={rows}
        />
      </CardContent>
    </Card>
  );
}
