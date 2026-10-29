import { Suspense } from 'react';

import { getFormatter, getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
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
import {
  loadCountryOptions,
  loadSpaces,
} from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { CreateSpaceDialog } from './_components/create-space-dialog';

interface SpacesPageProps {
  params: Promise<{ account: string }>;
}

type Params = SpacesPageProps['params'];

export const generateMetadata = async () => {
  const t = await getTranslations('campaigns');

  return {
    title: t('spaces.pageTitle'),
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

  const [spaces, countries, format] = await Promise.all([
    loadSpaces(client, account.id),
    loadCountryOptions(client),
    getFormatter(),
  ]);

  const countryName = (code: string) =>
    countries.find((country) => country.code === code)?.label ?? code;

  return (
    <Card>
      <CardHeader className={'flex flex-row items-start justify-between'}>
        <div className={'flex flex-col space-y-1.5'}>
          <CardTitle>
            <Trans i18nKey={'campaigns.spaces.listTitle'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'campaigns.spaces.listDescription'} />
          </CardDescription>
        </div>

        <CreateSpaceDialog accountId={account.id} countries={countries} />
      </CardHeader>

      <CardContent>
        <If
          condition={spaces.length > 0}
          fallback={
            <p
              className={'text-muted-foreground py-6 text-center text-sm'}
              data-test={'spaces-empty'}
            >
              <Trans i18nKey={'campaigns.spaces.empty'} />
            </p>
          }
        >
          <Table data-test={'spaces-table'}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans i18nKey={'campaigns.spaces.nameColumn'} />
                </TableHead>

                <TableHead>
                  <Trans i18nKey={'campaigns.spaces.countryColumn'} />
                </TableHead>

                <TableHead>
                  <Trans i18nKey={'campaigns.spaces.createdAtColumn'} />
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {spaces.map((space) => (
                <TableRow key={space.id}>
                  <TableCell className={'font-medium'}>{space.name}</TableCell>

                  <TableCell>{countryName(space.country_code)}</TableCell>

                  <TableCell>
                    {format.dateTime(new Date(space.created_at), {
                      dateStyle: 'medium',
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </If>
      </CardContent>
    </Card>
  );
}
