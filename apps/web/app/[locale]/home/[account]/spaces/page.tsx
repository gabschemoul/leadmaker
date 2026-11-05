import { Suspense } from 'react';

import { getFormatter, getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Card, CardContent, CardDescription, CardHeader } from '@kit/ui/card';
import { PageBody } from '@kit/ui/page';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Trans } from '@kit/ui/trans';

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadSpaces } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { CreateSpaceDialog } from './_components/create-space-dialog';
import { SpaceRowActions } from './_components/space-row-actions';

interface SpacesPageProps {
  params: Promise<{ account: string }>;
}

type Params = SpacesPageProps['params'];

export const generateMetadata = async () => {
  const t = await getTranslations('campaigns');

  return {
    title: t('folders.pageTitle'),
  };
};

function SpacesPage({ params }: SpacesPageProps) {
  return (
    <PageBody>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <SpacesPageHeader params={params} />
      </Suspense>

      <div className={'flex w-full max-w-4xl flex-col pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <CardSkeleton rows={3} />
            </Delayed>
          }
        >
          <SpacesCard params={params} />
        </Suspense>
      </div>
    </PageBody>
  );
}

export default SpacesPage;

async function SpacesPageHeader({ params }: { params: Params }) {
  const { account } = await params;

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'common.routes.spaces'} />}
      description={<AppBreadcrumbs />}
    />
  );
}

async function SpacesCard({ params }: { params: Params }) {
  const { account: slug } = await params;
  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();

  const [spaces, format] = await Promise.all([
    loadSpaces(client, account.id),
    getFormatter(),
  ]);

  return (
    <Card>
      <CardHeader className={'flex flex-row items-start justify-between gap-4'}>
        <CardDescription className={'max-w-xl'}>
          <Trans i18nKey={'campaigns.folders.intro'} />
        </CardDescription>

        <CreateSpaceDialog accountId={account.id} />
      </CardHeader>

      <CardContent>
        <Table data-test={'folders-table'}>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans i18nKey={'campaigns.folders.nameColumn'} />
              </TableHead>

              <TableHead>
                <Trans i18nKey={'campaigns.folders.createdAtColumn'} />
              </TableHead>

              <TableHead />
            </TableRow>
          </TableHeader>

          <TableBody>
            {spaces.map((space) => (
              <TableRow key={space.id} data-test={'folder-row'}>
                <TableCell className={'font-medium'}>{space.label}</TableCell>

                <TableCell>
                  {format.dateTime(new Date(space.created_at), {
                    dateStyle: 'medium',
                  })}
                </TableCell>

                <TableCell>
                  <SpaceRowActions
                    accountId={account.id}
                    spaceId={space.id}
                    name={space.label}
                    isDefault={space.is_default}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
