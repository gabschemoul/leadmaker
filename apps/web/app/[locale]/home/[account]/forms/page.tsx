import { Suspense } from 'react';

import Link from 'next/link';

import { Loader2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@kit/ui/card';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import {
  Delayed,
  PageHeaderSkeleton,
  TableSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';
import {
  ALWAYS_VISIBLE_GROUPS,
  ATTEMPT_GROUP_ORDER,
  type AttemptGroup,
  isAttemptGroup,
} from '~/lib/leadmaker/attempts';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadSpaces } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { FolderSwitch } from '../sender/_components/folder-switch';
import { FormsTable } from './_components/forms-table';
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
      <Suspense fallback={<PageHeaderSkeleton />}>
        <FormsPageHeader params={params} />
      </Suspense>

      <div className={'flex w-full flex-col pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <TableSkeleton rows={8} />
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

async function FormsPageHeader({
  params,
}: {
  params: FormsPageProps['params'];
}) {
  const { account } = await params;

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'common.routes.forms'} />}
      description={<AppBreadcrumbs />}
    />
  );
}

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

  const counts = await loadAttemptCounts(client, space.id);

  // Sans onglet choisi : « Prêts », ou le premier onglet non vide (robot au
  // travail, formulaires à compléter…) pour ne jamais tomber sur une liste vide
  const group: AttemptGroup = isAttemptGroup(rawSearchParams.status)
    ? rawSearchParams.status
    : (ATTEMPT_GROUP_ORDER.find((item) => counts[item] > 0) ?? 'ready');

  const rows = await loadAttempts(client, { spaceId: space.id, group });

  const basePath = pathsConfig.app.accountForms.replace('[account]', slug);

  const href = (target: AttemptGroup) => {
    const search = new URLSearchParams();
    if (showFolders) search.set('space', space.id);
    if (target !== 'ready') search.set('status', target);
    const query = search.toString();

    return query ? `${basePath}?${query}` : basePath;
  };

  const visibleGroups = ATTEMPT_GROUP_ORDER.filter(
    (item) => ALWAYS_VISIBLE_GROUPS.includes(item) || counts[item] > 0,
  );

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

        <nav className={'flex flex-wrap gap-2'} data-test={'forms-groups'}>
          {visibleGroups.map((item) => (
            <Button
              key={item}
              size={'sm'}
              variant={item === group ? 'default' : 'outline'}
              nativeButton={false}
              data-test={`forms-group-${item}`}
              render={<Link href={href(item)} />}
            >
              <Trans i18nKey={`outreach.forms.groups.${item}`} />

              <span
                className={cn(
                  'tabular-nums',
                  item === group ? 'opacity-80' : 'text-muted-foreground',
                )}
              >
                {counts[item]}
              </span>
            </Button>
          ))}
        </nav>

        <p
          className={'text-muted-foreground text-sm'}
          data-test={'forms-group-hint'}
        >
          <Trans i18nKey={`outreach.forms.groupHints.${group}`} />
        </p>
      </CardHeader>

      <CardContent>
        <FormsTable
          key={`${space.id}:${group}`}
          rows={rows}
          group={group}
          accountId={account.id}
          spaceId={space.id}
          preparing={counts.preparing}
        />
      </CardContent>
    </Card>
  );
}
