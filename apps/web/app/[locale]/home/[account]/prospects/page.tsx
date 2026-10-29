import { Suspense } from 'react';

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import * as z from 'zod';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import {
  Delayed,
  PageHeaderSkeleton,
  TableSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';

import { ProspectsTable } from '../_components/leadmaker/prospects-table';
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadSpaces } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { ImportProspectsDialog } from './_components/import-prospects-dialog';
import { ProspectsFilters } from './_components/prospects-filters';
import {
  PROSPECTS_PAGE_SIZE,
  loadProspectsPage,
} from './_lib/server/prospects.loader';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface ProspectsPageProps {
  params: Promise<{ account: string }>;
  searchParams: SearchParams;
}

const SearchParamsSchema = z.object({
  space: z.string().uuid().optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  source: z.enum(['maps', 'csv']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
});

export const generateMetadata = async () => {
  const t = await getTranslations('campaigns');

  return {
    title: t('prospects.pageTitle'),
  };
};

function ProspectsPage({ params, searchParams }: ProspectsPageProps) {
  return (
    <PageBody>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <ProspectsPageHeader params={params} />
      </Suspense>

      <div className={'flex w-full flex-col pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <TableSkeleton rows={10} />
            </Delayed>
          }
        >
          <ProspectsContent params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageBody>
  );
}

export default ProspectsPage;

async function ProspectsPageHeader({
  params,
}: {
  params: ProspectsPageProps['params'];
}) {
  const { account } = await params;

  return (
    <TeamAccountLayoutPageHeader
      account={account}
      title={<Trans i18nKey={'common.routes.prospects'} />}
      description={<AppBreadcrumbs />}
    />
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function ProspectsContent(props: ProspectsPageProps) {
  const [{ account: slug }, rawSearchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  const search = SearchParamsSchema.parse({
    space: first(rawSearchParams.space),
    q: first(rawSearchParams.q),
    source: first(rawSearchParams.source),
    page: first(rawSearchParams.page),
  });

  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();
  const spaces = await loadSpaces(client, account.id);

  // l'espace par défaut vient en premier ; avec un seul dossier client, la
  // notion reste invisible (pas de filtre, pas de paramètre d'URL)
  const showFolders = spaces.length > 1;
  const space = spaces.find((item) => item.id === search.space) ?? spaces[0]!;
  const page = search.page ?? 1;
  const query = search.q ?? '';
  const source = search.source ?? null;

  const [{ prospects, total }, format] = await Promise.all([
    loadProspectsPage(client, { spaceId: space.id, query, source, page }),
    getFormatter(),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PROSPECTS_PAGE_SIZE));
  const basePath = pathsConfig.app.accountProspects.replace('[account]', slug);

  const pageHref = (target: number) => {
    const urlParams = new URLSearchParams();

    if (showFolders) urlParams.set('space', space.id);

    if (query) urlParams.set('q', query);
    if (source) urlParams.set('source', source);
    if (target > 1) urlParams.set('page', String(target));

    const queryString = urlParams.toString();

    return queryString ? `${basePath}?${queryString}` : basePath;
  };

  // page au-delà de la dernière (lien périmé) : on revient à la dernière
  if (prospects.length === 0 && page > pageCount) {
    redirect(pageHref(pageCount));
  }

  const folderOptions = showFolders
    ? spaces.map(({ id, label }) => ({ id, label }))
    : [];

  return (
    <Card>
      <CardHeader
        className={
          'flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between'
        }
      >
        <ProspectsFilters
          action={basePath}
          folders={folderOptions}
          spaceId={space.id}
          query={query}
          source={source ?? ''}
        />

        <div className={'flex gap-2'}>
          <ImportProspectsDialog
            folders={folderOptions}
            defaultSpaceId={space.id}
          />

          <Button
            size={'sm'}
            variant={'outline'}
            nativeButton={false}
            data-test={'export-prospects-button'}
            render={
              <a href={`/api/leadmaker/export?space_id=${space.id}`} download />
            }
          >
            <Download className={'w-4'} />

            <span>
              <Trans i18nKey={'campaigns.export.button'} />
            </span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        {prospects.length === 0 ? (
          <p
            className={'text-muted-foreground py-10 text-center text-sm'}
            data-test={'prospects-empty'}
          >
            <Trans
              i18nKey={
                query || source
                  ? 'campaigns.prospects.noMatch'
                  : 'campaigns.prospects.empty'
              }
            />
          </p>
        ) : (
          <ProspectsTable prospects={prospects} showSource />
        )}

        <div
          className={
            'text-muted-foreground flex items-center justify-between text-sm'
          }
        >
          <span data-test={'prospects-total'}>
            <Trans
              i18nKey={'campaigns.prospects.total'}
              values={{ count: total, formatted: format.number(total) }}
            />
          </span>

          {pageCount > 1 ? (
            <div className={'flex items-center gap-2'}>
              <PageLink
                href={page > 1 ? pageHref(page - 1) : null}
                dataTest={'prospects-previous-page'}
              >
                <ChevronLeft className={'w-4'} />

                <Trans i18nKey={'campaigns.prospects.previousPage'} />
              </PageLink>

              <span className={'tabular-nums'}>
                <Trans
                  i18nKey={'campaigns.prospects.pageOf'}
                  values={{ page, count: pageCount }}
                />
              </span>

              <PageLink
                href={page < pageCount ? pageHref(page + 1) : null}
                dataTest={'prospects-next-page'}
              >
                <Trans i18nKey={'campaigns.prospects.nextPage'} />

                <ChevronRight className={'w-4'} />
              </PageLink>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PageLink(
  props: React.PropsWithChildren<{ href: string | null; dataTest: string }>,
) {
  if (!props.href) {
    return (
      <Button size={'sm'} variant={'outline'} disabled>
        {props.children}
      </Button>
    );
  }

  return (
    <Button
      size={'sm'}
      variant={'outline'}
      nativeButton={false}
      data-test={props.dataTest}
      render={<Link href={props.href} />}
    >
      {props.children}
    </Button>
  );
}
