'use client';

/**
 * Rôle : écran « Vos entreprises » d'une campagne triée (CDC-PARCOURS-TRI-ANNUAIRE §6) : cible, avancement,
 * encart des groupes (§4.3), onglets Gardées / À vérifier, choix du client sur les entreprises à vérifier.
 * Données : fetchCampaignLive (dont lm_campaign_sort_summary et lm_campaign_groups) + temps réel,
 * fetchSortedCompanies (lm_campaign_prospects) page par page, dans le navigateur.
 * Écritures : chooseProspectsAction (lm_choose_prospects), startCampaignAction / pauseCampaignAction, actions de
 * l'encart des groupes (campaign-groups.tsx).
 */

import { useState } from 'react';

import Link from 'next/link';

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ArrowRight, Check, Pencil, X } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import { Progress } from '@kit/ui/progress';
import { toast } from '@kit/ui/sonner';
import { Spinner } from '@kit/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Trans } from '@kit/ui/trans';

import {
  COMPANIES_PAGE_SIZE,
  type CompaniesTab,
  type SortedCompany,
  fetchSortedCompanies,
} from '~/lib/leadmaker/sorted-companies-query';
import { websiteHref, websiteLabel } from '~/lib/leadmaker/website';

import { CampaignStatusBadge } from '../../../_components/leadmaker/campaign-status-badge';
import { ProspectDrawer } from '../../../_components/leadmaker/prospect-drawer';
import type { ProspectRow } from '../../../_components/leadmaker/prospects-table';
import { type CampaignLive, fetchCampaignLive } from '../../_lib/campaign-live';
import { chooseProspectsAction } from '../../_lib/server/sort-actions';
import { CampaignGroups, groupLabels } from './campaign-groups';
import {
  CampaignActions,
  PauseAlerts,
  useCampaignRealtime,
} from './discover-step';

const REFRESH_INTERVAL = 10_000;

type SortState = NonNullable<CampaignLive['sort']>;

/**
 * Étape 2, « Vos entreprises » : les entreprises trouvées et triées selon la cible. Gardées sans bouton ;
 * À vérifier avec « Garder » et « Écarter ». Les écartées ne sont jamais montrées.
 */
export function CompaniesStep(props: {
  campaignId: string;
  /** retour à l'écran « Qui ? » de la campagne (changer la cible relance le tri) */
  editHref: string;
  writeHref: string;
  billingPath: string;
  /** liste des campagnes de l'équipe (campagnes créées par groupe) */
  campaignsPath: string;
  initialData: CampaignLive;
}) {
  const client = useSupabase();
  const queryKey = ['lm-campaign-live', props.campaignId];
  const [tab, setTab] = useState<CompaniesTab>('kept');

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchCampaignLive(client, props.campaignId),
    initialData: props.initialData,
    staleTime: 5_000,
    // les nombres avancent tant que la recherche tourne ou que des entreprises attendent leur tri
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ||
      (query.state.data?.sort?.pending ?? 0) > 0
        ? REFRESH_INTERVAL
        : false,
  });

  useCampaignRealtime(props.campaignId, queryKey);

  // page ouverte avant un changement de cible ailleurs : rien à trier, l'écran reste lisible
  const sort: SortState = data.sort ?? {
    target: '',
    version: 0,
    total: 0,
    kept: 0,
    toCheck: 0,
    pending: 0,
    examined: 0,
    creditsPerProspect: 1,
    pricePending: true,
  };

  const live = data.status === 'running' || sort.pending > 0;

  return (
    <div
      className={'flex flex-col gap-4'}
      data-test={'campaign-step-companies'}
    >
      <PauseAlerts
        live={data}
        billingPath={props.billingPath}
        targetHref={props.editHref}
        editHref={props.editHref}
      />

      <Card data-test={'campaign-companies'}>
        <CardHeader>
          <div
            className={
              'flex flex-col gap-3 md:flex-row md:items-start md:justify-between'
            }
          >
            <div className={'flex min-w-0 flex-col gap-1.5'}>
              <CardTitle className={'flex items-center gap-3'}>
                <Trans i18nKey={'campaigns.companies.title'} />
                <CampaignStatusBadge status={data.status} />
              </CardTitle>

              {/* Texte en ligne (pas de flex) : « · Modifier » suit la fin de la cible au lieu de tomber
                  seul sur la ligne suivante quand la cible est longue */}
              <CardDescription data-test={'campaign-companies-target'}>
                <span>{sort.target}</span> <span aria-hidden>·</span>{' '}
                <Link
                  href={props.editHref}
                  className={
                    'text-brand inline-flex items-center gap-1 whitespace-nowrap'
                  }
                  data-test={'campaign-companies-edit-target'}
                >
                  <Pencil className={'size-3'} />
                  <Trans i18nKey={'campaigns.companies.editTarget'} />
                </Link>
              </CardDescription>
            </div>

            <div className={'flex shrink-0 items-center gap-2'}>
              <CampaignActions
                campaignId={props.campaignId}
                status={data.status}
                queryKey={queryKey}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className={'flex flex-col gap-5'}>
          <SearchProgress
            progress={data.progress}
            live={data.status === 'running'}
            completed={data.status === 'completed'}
          />

          <SortProgress sort={sort} live={live} />

          <CampaignGroups
            campaignId={props.campaignId}
            campaignsPath={props.campaignsPath}
            writeHref={props.writeHref}
            groups={data.groups}
            queryKey={queryKey}
          />

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as CompaniesTab)}
            className={'flex-col gap-4'}
          >
            <div className={'flex flex-wrap items-center gap-x-4 gap-y-2'}>
              <TabsList data-test={'campaign-companies-tabs'}>
                <TabsTrigger
                  value={'kept'}
                  className={'px-3'}
                  data-test={'campaign-companies-tab-kept'}
                >
                  <Trans i18nKey={'campaigns.companies.tabKept'} />
                  <TabCount value={sort.kept} />
                </TabsTrigger>

                <TabsTrigger
                  value={'toCheck'}
                  className={'px-3'}
                  data-test={'campaign-companies-tab-to-check'}
                >
                  <Trans i18nKey={'campaigns.companies.tabToCheck'} />
                  <TabCount value={sort.toCheck} />
                </TabsTrigger>
              </TabsList>

              {/* l'argent reste visible (analyse UX E-01 / T-03, CDC §5.2), en deux chiffres sobres : prix d'une
                  gardée et crédits utilisés. Le solde est déjà dans la barre du haut (retour de Gabriel, 11/11). */}
              <dl
                className={
                  'ml-auto flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm'
                }
                data-test={'campaign-companies-price'}
              >
                <div className={'flex items-baseline gap-1.5'}>
                  <dt className={'text-muted-foreground'}>
                    <Trans i18nKey={'campaigns.companies.priceLabel'} />
                  </dt>

                  <dd className={'font-medium tabular-nums'}>
                    {sort.pricePending ? (
                      <Trans i18nKey={'campaigns.companies.priceMeasuring'} />
                    ) : (
                      <Trans
                        i18nKey={'campaigns.companies.price'}
                        values={{ count: sort.creditsPerProspect }}
                      />
                    )}
                  </dd>
                </div>

                {data.money ? (
                  <div
                    className={'flex items-baseline gap-1.5'}
                    data-test={'campaign-companies-spent'}
                  >
                    <dt className={'text-muted-foreground'}>
                      <Trans i18nKey={'campaigns.companies.spentLabel'} />
                    </dt>

                    <dd className={'font-medium tabular-nums'}>
                      <Trans
                        i18nKey={'campaigns.companies.spent'}
                        values={{ count: data.money.spent }}
                      />
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <CompaniesList
              key={`${tab}:${sort.version}`}
              campaignId={props.campaignId}
              version={sort.version}
              tab={tab}
              live={live}
              waiting={sort.pending > 0 || data.status === 'running'}
              groupLabels={groupLabels(data.groups)}
            />
          </Tabs>
        </CardContent>
      </Card>

      <div className={'flex justify-end'}>
        <Button
          size={'lg'}
          nativeButton={false}
          data-test={'campaign-step-next'}
          render={<Link href={props.writeHref} />}
        >
          <span>
            <Trans i18nKey={'campaigns.companies.next'} />
          </span>
          <ArrowRight className={'w-4'} />
        </Button>
      </div>
    </div>
  );
}

function TabCount(props: { value: number }) {
  const format = useFormatter();

  return (
    <span className={'text-muted-foreground tabular-nums'}>
      {format.number(props.value)}
    </span>
  );
}

/** Avancement discret : fiches examinées par la recherche, part des entreprises déjà triées. */
/**
 * Avancement de la recherche (recherches faites sur le total des villes × activités), comme l'ancienne étape
 * Trouver : sans lui, on ne voit plus combien il reste à chercher (remarque de Gabriel, 10/11/2026).
 */
function SearchProgress(props: {
  progress: CampaignLive['progress'];
  live: boolean;
  completed: boolean;
}) {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations('campaigns.companies');
  const { searchesDone, searchesTotal, abandoned, phase } = props.progress;
  // avant la première recherche finie, on dit ce qui se passe au lieu de « 0 recherche faite » (retour du 11/11)
  const step = props.live && searchesDone === 0 ? launchStep(phase) : null;

  if (searchesTotal <= 0 && !step) {
    return null;
  }

  const raw =
    searchesTotal > 0 ? Math.min(100, (searchesDone / searchesTotal) * 100) : 0;
  // une décimale sous 10 % : « 0,7 % » plutôt qu'un « 0 % » trompeur quand la recherche prévue est immense
  const percent = raw < 10 ? Math.floor(raw * 10) / 10 : Math.floor(raw);

  return (
    <div
      className={'flex flex-col gap-2'}
      data-test={'campaign-search-progress'}
    >
      <div
        className={
          'text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm'
        }
      >
        <span className={'flex items-center gap-2'}>
          {props.live ? <Spinner className={'size-3.5'} /> : null}
          <span className={'text-foreground font-medium'}>
            <Trans i18nKey={'campaigns.companies.searchLabel'} />
          </span>
          <span data-test={'campaign-search-step'}>
            {step ? (
              <Trans
                i18nKey={`campaigns.companies.launchStep.${step.key}`}
                values={{
                  ...step.values,
                  time:
                    step.key === 'resume' && phase?.resumeAt
                      ? format.dateTime(new Date(phase.resumeAt), {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '',
                }}
              />
            ) : (
              <Trans
                i18nKey={'campaigns.detail.searchesProgress'}
                values={{ done: searchesDone, total: searchesTotal }}
              />
            )}
          </span>
        </span>

        {step ? null : (
          <span className={'tabular-nums'}>
            {format.number(percent, { maximumFractionDigits: 1 })} %
          </span>
        )}
      </div>

      <Progress value={percent} locale={locale} aria-label={t('searchLabel')} />

      {/* activité arrêtée faute de résultats : dit pourquoi la recherche s'est arrêtée avant la fin */}
      {props.completed && abandoned > 0 ? (
        <p
          className={'text-muted-foreground text-sm'}
          data-test={'campaign-search-abandoned'}
        >
          <Trans
            i18nKey={'campaigns.companies.searchAbandoned'}
            values={{ count: abandoned }}
          />
        </p>
      ) : null}
    </div>
  );
}

/** Étape du lancement montrée tant qu'aucune recherche n'est finie (lm_campaign_search_phase). */
function launchStep(phase: CampaignLive['progress']['phase']): {
  key: string;
  values: Record<string, number>;
} | null {
  if (!phase) {
    return null;
  }

  if (phase.running > 0) {
    return { key: 'running', values: {} };
  }

  if (phase.resumeAt) {
    return { key: 'resume', values: {} };
  }

  if (phase.queued === 0) {
    return { key: 'preparing', values: {} };
  }

  return { key: 'starting', values: {} };
}

function SortProgress(props: { sort: SortState; live: boolean }) {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations('campaigns.companies');
  const { sort } = props;
  const sorted = Math.max(0, sort.total - sort.pending);
  const percent =
    sort.total > 0 ? Math.min(100, Math.round((sorted / sort.total) * 100)) : 0;

  return (
    <div className={'flex flex-col gap-2'} data-test={'campaign-sort-progress'}>
      <div
        className={
          'text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm'
        }
      >
        <span className={'flex items-center gap-2'}>
          {props.live ? <Spinner className={'size-3.5'} /> : null}
          <span className={'text-foreground font-medium'}>
            <Trans i18nKey={'campaigns.companies.sortLabel'} />
          </span>
        </span>

        {sort.total > 0 ? (
          <span className={'tabular-nums'}>
            <Trans
              i18nKey={'campaigns.companies.sorted'}
              values={{
                done: format.number(sorted),
                total: format.number(sort.total),
              }}
            />
          </span>
        ) : null}
      </div>

      <Progress value={percent} locale={locale} aria-label={t('sortedLabel')} />
    </div>
  );
}

/** Liste d'un onglet, page par page ; dans « À vérifier », sélection et boutons « Garder » / « Écarter ». */
function CompaniesList(props: {
  campaignId: string;
  version: number;
  tab: CompaniesTab;
  /** recherche ou tri en cours : la liste se relit d'elle-même */
  live: boolean;
  /** des entreprises vont encore arriver (texte de la liste vide) */
  waiting: boolean;
  /** libellé de chaque groupe (campagne à plusieurs groupes), affiché en petit sur la ligne */
  groupLabels: Map<string, string> | null;
}) {
  const t = useTranslations();
  const client = useSupabase();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  // fiche ouverte dans le tiroir (même fiche que la page Prospects)
  const [openId, setOpenId] = useState<string | null>(null);
  const choosable = props.tab === 'toCheck';

  const listKey = [
    'lm-sorted-companies',
    props.campaignId,
    props.version,
    props.tab,
  ];

  const query = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) =>
      fetchSortedCompanies(client, {
        campaignId: props.campaignId,
        version: props.version,
        tab: props.tab,
        page: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === COMPANIES_PAGE_SIZE ? pages.length : undefined,
    staleTime: 5_000,
    refetchInterval: props.live ? REFRESH_INTERVAL * 1.5 : false,
  });

  const choose = useAction(chooseProspectsAction, {
    onSuccess: ({ data }) => {
      if (data) {
        toast.success(
          t(
            data.choice === 'gardee'
              ? 'campaigns.companies.keptToast'
              : 'campaigns.companies.droppedToast',
            { count: data.count },
          ),
        );
      }

      setSelected([]);

      void queryClient.invalidateQueries({
        queryKey: ['lm-sorted-companies', props.campaignId],
      });

      void queryClient.invalidateQueries({
        queryKey: ['lm-campaign-live', props.campaignId],
      });
    },
    onError: ({ error }) => {
      toast.error(t(error.serverError ?? 'campaigns.companies.chooseFailed'));
    },
  });

  const rows = query.data?.pages.flat() ?? [];
  const visibleIds = rows.map((row) => row.id);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const pendingIds = choose.isPending ? (choose.input?.prospectIds ?? []) : [];

  const execute = (prospectIds: string[], choice: 'gardee' | 'ecartee') =>
    choose.execute({ campaignId: props.campaignId, prospectIds, choice });

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id),
    );

  if (query.isPending) {
    return (
      <div className={'flex justify-center py-10'}>
        <Spinner className={'size-5'} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className={'text-destructive py-6 text-sm'}>
        <Trans i18nKey={'campaigns.companies.loadFailed'} />
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p
        className={'text-muted-foreground py-10 text-center text-sm'}
        data-test={'campaign-companies-empty'}
      >
        <Trans
          i18nKey={
            props.waiting
              ? 'campaigns.companies.emptyWaiting'
              : props.tab === 'kept'
                ? 'campaigns.companies.emptyKept'
                : 'campaigns.companies.emptyToCheck'
          }
        />
      </p>
    );
  }

  return (
    <div className={'flex flex-col gap-3'}>
      {choosable ? (
        <div
          className={
            'flex min-h-8 flex-wrap items-center justify-between gap-2 text-sm'
          }
        >
          <label
            className={
              'text-muted-foreground flex cursor-pointer items-center gap-2'
            }
          >
            <Checkbox
              data-test={'campaign-companies-select-all'}
              checked={allSelected}
              onCheckedChange={(checked) =>
                setSelected(checked ? visibleIds : [])
              }
            />

            {selected.length > 0 ? (
              <Trans
                i18nKey={'campaigns.companies.selected'}
                values={{ count: selected.length }}
              />
            ) : (
              <Trans i18nKey={'campaigns.companies.selectAll'} />
            )}
          </label>

          {selected.length > 0 ? (
            <div className={'flex items-center gap-2'}>
              <Button
                size={'sm'}
                disabled={choose.isPending}
                data-test={'campaign-companies-keep-selected'}
                onClick={() => execute(selected, 'gardee')}
              >
                <Check className={'size-3.5'} />
                <Trans i18nKey={'campaigns.companies.keep'} />
              </Button>

              <Button
                size={'sm'}
                variant={'outline'}
                disabled={choose.isPending}
                data-test={'campaign-companies-drop-selected'}
                onClick={() => execute(selected, 'ecartee')}
              >
                <X className={'size-3.5'} />
                <Trans i18nKey={'campaigns.companies.drop'} />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ul
        className={'divide-border divide-y rounded-lg border'}
        data-test={'campaign-companies-list'}
      >
        {rows.map((row) => (
          <CompanyRow
            key={row.id}
            row={row}
            group={
              row.groupKey
                ? (props.groupLabels?.get(row.groupKey) ?? null)
                : null
            }
            choosable={choosable}
            checked={selected.includes(row.id)}
            onCheckedChange={(checked) => toggle(row.id, checked)}
            pending={pendingIds.includes(row.id)}
            disabled={choose.isPending}
            onChoose={(choice) => execute([row.id], choice)}
            onOpen={() => setOpenId(row.id)}
          />
        ))}
      </ul>

      {query.hasNextPage ? (
        <div className={'flex justify-center'}>
          <Button
            variant={'outline'}
            size={'sm'}
            loading={query.isFetchingNextPage}
            data-test={'campaign-companies-more'}
            onClick={() => void query.fetchNextPage()}
          >
            <Trans i18nKey={'campaigns.companies.more'} />
          </Button>
        </div>
      ) : null}

      <ProspectDrawer
        prospect={
          (rows.find((row) => row.id === openId)?.prospect as
            | ProspectRow
            | null
            | undefined) ?? null
        }
        onOpenChange={(open) => {
          if (!open) {
            setOpenId(null);
          }
        }}
      />
    </div>
  );
}

function CompanyRow(props: {
  row: SortedCompany;
  /** libellé du groupe de l'entreprise, null sans groupe */
  group: string | null;
  choosable: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  pending: boolean;
  disabled: boolean;
  onChoose: (choice: 'gardee' | 'ecartee') => void;
  onOpen: () => void;
}) {
  const { row } = props;
  const site = websiteHref(row.website);

  return (
    <li
      className={'flex items-start gap-3 px-4 py-3'}
      data-test={'campaign-company-row'}
    >
      {props.choosable ? (
        <Checkbox
          className={'mt-0.5'}
          aria-label={row.name}
          checked={props.checked}
          onCheckedChange={(checked) => props.onCheckedChange(checked)}
        />
      ) : null}

      <div className={'flex min-w-0 flex-1 flex-col gap-0.5'}>
        <div className={'flex flex-wrap items-baseline gap-x-2'}>
          {/* clic : fiche complète (analyse UX E-03 : voir ce qu'on paie avant de « Garder ») */}
          <button
            type={'button'}
            className={'cursor-pointer text-left font-medium hover:underline'}
            data-test={'campaign-company-open'}
            onClick={props.onOpen}
          >
            {row.name}
          </button>

          {row.city ? (
            <span className={'text-muted-foreground text-sm'}>{row.city}</span>
          ) : null}

          {props.group ? (
            <span
              className={'text-muted-foreground text-xs'}
              data-test={'campaign-company-group'}
            >
              {props.group}
            </span>
          ) : null}
        </div>

        {row.category || site || row.phone ? (
          <p
            className={
              'text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-sm'
            }
            data-test={'campaign-company-details'}
          >
            {row.category ? <span>{row.category}</span> : null}

            {site ? (
              <a
                href={site}
                target={'_blank'}
                rel={'noreferrer noopener'}
                className={'text-brand hover:underline'}
              >
                {websiteLabel(row.website ?? site)}
              </a>
            ) : null}

            {row.phone ? (
              <a href={`tel:${row.phone}`} className={'hover:underline'}>
                {row.phone}
              </a>
            ) : null}
          </p>
        ) : null}

        {row.reason ? (
          <p className={'text-muted-foreground text-sm'}>{row.reason}</p>
        ) : null}
      </div>

      {props.choosable ? (
        <div className={'flex shrink-0 items-center gap-1.5'}>
          <Button
            size={'sm'}
            variant={'outline'}
            disabled={props.disabled}
            loading={props.pending}
            data-test={'campaign-company-keep'}
            onClick={() => props.onChoose('gardee')}
          >
            <Trans i18nKey={'campaigns.companies.keep'} />
          </Button>

          <Button
            size={'sm'}
            variant={'ghost'}
            disabled={props.disabled}
            data-test={'campaign-company-drop'}
            onClick={() => props.onChoose('ecartee')}
          >
            <Trans i18nKey={'campaigns.companies.drop'} />
          </Button>
        </div>
      ) : null}
    </li>
  );
}
