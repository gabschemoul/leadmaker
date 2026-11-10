'use client';

/**
 * Rôle : panneau de la page Prospects (filtres, export, tableau, pages), filtré sur place (10/11/2026,
 * « PARTOUT sur l'app ça doit être instantané »). Un clic sur un filtre, un tri ou une page change l'écran tout
 * de suite : seule la liste est redemandée à la base (fetchProspectsPage, RLS), l'ancienne reste affichée en
 * transparence le temps de la réponse, et la page n'est plus rechargée. La recherche filtre pendant la frappe.
 * L'adresse (?q=, ?page=…) suit en silence pour qu'un lien ou un rechargement garde la vue.
 * Écritures : aucune ici (actions groupées dans ProspectsTable).
 */
import { Suspense, use, useState } from 'react';

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useFormatter } from 'next-intl';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import {
  type ProspectListRow,
  fetchProspectsPage,
} from '~/lib/leadmaker/prospects-page-query';
import {
  EMPTY_PROSPECTS_FILTERS,
  PROSPECTS_PAGE_SIZE,
  type ProspectsFilters as Filters,
  type ProspectsListState,
  buildProspectsHref,
  countActiveFilters,
  toProspectsSearchParams,
} from '~/lib/leadmaker/prospects-query';

import { isProspectSortKey } from '../../_components/leadmaker/prospect-columns';
import {
  ProspectsTable,
  type SortingState,
} from '../../_components/leadmaker/prospects-table';
import { useDebouncedValue } from '../../campaigns/_lib/use-debounced-value';
import { ProspectsFilters } from './prospects-filters';

/** Pause de frappe avant d'interroger la base pendant une recherche. */
const SEARCH_DELAY_MS = 250;

type ListState = Pick<ProspectsListState, 'page' | 'sort' | 'dir' | 'filters'>;

type Facet = { value: string; total: number };

interface ProspectFacets {
  categories: Facet[];
  cities: Facet[];
  campaigns: Facet[];
}

const NO_FACETS: ProspectFacets = { categories: [], cities: [], campaigns: [] };

export function ProspectsBrowser(props: {
  basePath: string;
  initialState: ListState;
  /** identifiant du dossier à garder dans l'URL (absent avec un seul dossier) */
  spaceParam: string | undefined;
  spaceId: string;
  folders: Array<{ id: string; label: string }>;
  campaigns: Array<{ id: string; name: string }>;
  /** compteurs des filtres, envoyés après les lignes (pas attendus pour afficher la liste) */
  facets: Promise<ProspectFacets>;
  initialProspects: ProspectListRow[];
  initialTotal: number;
  accountId: string;
  campaignsPath: string;
  formsHref: string;
  canDelete: boolean;
  importDialog: React.ReactNode;
}) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const format = useFormatter();
  const [state, setState] = useState<ListState>(props.initialState);

  // la recherche attend une courte pause de frappe ; les autres filtres partent tout de suite
  const debouncedQuery = useDebouncedValue(
    state.filters.query,
    SEARCH_DELAY_MS,
  );

  const query: ListState = {
    ...state,
    filters: { ...state.filters, query: debouncedQuery?.trim() || undefined },
  };

  const queryHref = buildProspectsHref(props.basePath, {
    ...query,
    space: props.spaceParam,
  });

  const initialHref = buildProspectsHref(props.basePath, {
    ...props.initialState,
    space: props.spaceParam,
  });

  const queryKey = ['lm-prospects-page', props.spaceId, queryHref];

  const { data, isFetching, isPlaceholderData } = useQuery({
    queryKey,
    queryFn: () =>
      fetchProspectsPage(client, {
        spaceId: props.spaceId,
        page: query.page,
        sort: query.sort,
        dir: query.dir,
        filters: query.filters,
      }),
    initialData:
      queryHref === initialHref
        ? { prospects: props.initialProspects, total: props.initialTotal }
        : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const prospects = data?.prospects ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PROSPECTS_PAGE_SIZE));
  const loading = isFetching && (isPlaceholderData || !data);

  const update = (next: ListState) => {
    setState(next);

    // lien partageable, sans recharger la page
    window.history.replaceState(
      null,
      '',
      buildProspectsHref(props.basePath, { ...next, space: props.spaceParam }),
    );
  };

  const changeFilters = (patch: Partial<Filters>) =>
    update({ ...state, page: 1, filters: { ...state.filters, ...patch } });

  const resetFilters = () =>
    update({ ...state, page: 1, filters: EMPTY_PROSPECTS_FILTERS });

  const sorting: SortingState = [
    { id: state.sort, desc: state.dir === 'desc' },
  ];

  const onSortingChange = (next: SortingState) => {
    const [first] = next;

    if (!first || !isProspectSortKey(first.id)) return;

    update({
      ...state,
      page: 1,
      sort: first.id,
      dir: first.desc ? 'desc' : 'asc',
    });
  };

  // après une action groupée ou un changement en direct : la page affichée est redemandée
  const refetch = () =>
    void queryClient.invalidateQueries({
      queryKey: ['lm-prospects-page', props.spaceId],
    });

  const exportParams = toProspectsSearchParams({ filters: query.filters });
  exportParams.set('space_id', props.spaceId);

  const hasFilters = countActiveFilters(query.filters) > 0;

  const renderFilters = (facets: ProspectFacets) => {
    // nombre de prospects par campagne, pour le filtre
    const totals = new Map(
      facets.campaigns.map((facet) => [facet.value, facet.total]),
    );

    return (
      <ProspectsFilters
        basePath={props.basePath}
        filters={state.filters}
        onChange={changeFilters}
        onReset={resetFilters}
        folders={props.folders}
        spaceId={props.spaceId}
        campaigns={props.campaigns.map((campaign) => ({
          ...campaign,
          total: totals.get(campaign.id) ?? 0,
        }))}
        categories={facets.categories}
        cities={facets.cities}
      />
    );
  };

  return (
    <Card className={'gap-0 py-0'}>
      <CardHeader
        className={
          'flex flex-col gap-3 border-b px-4 py-3 xl:flex-row xl:items-start xl:justify-between'
        }
      >
        {/* filtres utilisables tout de suite ; listes Activité / Ville et totaux par campagne à l'arrivée des
            compteurs */}
        <Suspense fallback={renderFilters(NO_FACETS)}>
          <WithFacets facets={props.facets} render={renderFilters} />
        </Suspense>

        <div className={'flex shrink-0 gap-2'}>
          {props.importDialog}

          <Button
            size={'sm'}
            variant={'outline'}
            nativeButton={false}
            data-test={'export-prospects-button'}
            render={
              <a
                href={`/api/leadmaker/export?${exportParams.toString()}`}
                download
              />
            }
          >
            <Download className={'w-4'} />

            <span>
              <Trans
                i18nKey={
                  hasFilters
                    ? 'prospects.export.filtered'
                    : 'prospects.export.all'
                }
              />
            </span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className={'relative flex flex-col gap-0 px-0'}>
        <div
          className={cn('transition-opacity', loading && 'opacity-50')}
          aria-busy={loading}
        >
          <ProspectsTable
            framed={false}
            // nouvelle page, nouveau tri ou nouveaux filtres : la sélection repart de zéro
            key={queryHref}
            prospects={prospects}
            accountId={props.accountId}
            campaignsPath={props.campaignsPath}
            canDelete={props.canDelete}
            sorting={sorting}
            onSortingChange={onSortingChange}
            onMutated={refetch}
            onLiveChange={refetch}
            campaigns={props.campaigns}
            formsHref={props.formsHref}
            liveSpaceId={props.spaceId}
            noResultsMessage={
              loading ? (
                <Loader2
                  className={
                    'text-muted-foreground mx-auto size-5 animate-spin'
                  }
                />
              ) : (
                <span data-test={'prospects-empty'}>
                  <Trans
                    i18nKey={
                      hasFilters ? 'prospects.noMatch' : 'prospects.empty'
                    }
                  />
                </span>
              )
            }
          />
        </div>

        <div
          className={
            'text-muted-foreground flex items-center justify-between border-t px-4 py-2.5 text-[14px]'
          }
        >
          <span
            className={'flex items-center gap-2'}
            data-test={'prospects-total'}
          >
            <Trans
              i18nKey={'prospects.total'}
              values={{ count: total, formatted: format.number(total) }}
            />

            {loading ? <Loader2 className={'size-3.5 animate-spin'} /> : null}
          </span>

          {pageCount > 1 ? (
            <div className={'flex items-center gap-2'}>
              <Button
                size={'sm'}
                variant={'outline'}
                disabled={state.page <= 1}
                data-test={'prospects-previous-page'}
                onClick={() => update({ ...state, page: state.page - 1 })}
              >
                <ChevronLeft className={'w-4'} />

                <Trans i18nKey={'prospects.previousPage'} />
              </Button>

              <span className={'tabular-nums'}>
                <Trans
                  i18nKey={'prospects.pageOf'}
                  values={{ page: state.page, count: pageCount }}
                />
              </span>

              <Button
                size={'sm'}
                variant={'outline'}
                disabled={state.page >= pageCount}
                data-test={'prospects-next-page'}
                onClick={() => update({ ...state, page: state.page + 1 })}
              >
                <Trans i18nKey={'prospects.nextPage'} />

                <ChevronRight className={'w-4'} />
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function WithFacets(props: {
  facets: Promise<ProspectFacets>;
  render: (facets: ProspectFacets) => React.ReactNode;
}) {
  return props.render(use(props.facets));
}
