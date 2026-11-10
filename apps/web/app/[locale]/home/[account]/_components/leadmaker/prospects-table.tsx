'use client';

/**
 * Rôle : tableau de prospects partagé (page Prospects, détail de campagne) : tri, colonnes au choix, sélection.
 * Données : lignes ProspectRow passées par le parent ; temps réel sur lm_prospects (ProspectsLiveRefresh).
 * Écritures : aucune ici (actions groupées dans prospects-bulk-actions.tsx).
 */

import { useMemo, useState } from 'react';

import Link from 'next/link';

import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ExternalLink } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@kit/ui/badge';
import { Checkbox } from '@kit/ui/checkbox';
import { DataTable } from '@kit/ui/enhanced-data-table';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { LocalDateTime } from '~/components/local-date-time';
import { websiteHref, websiteLabel } from '~/lib/leadmaker/website';

import {
  DEFAULT_PROSPECT_COLUMN_VISIBILITY,
  PROSPECT_COLUMN_IDS,
  type ProspectColumnId,
  SORTABLE_PROSPECT_COLUMNS,
  prospectColumnsStorageKey,
} from './prospect-columns';
import { ProspectDrawer } from './prospect-drawer';
import { ProspectsBulkActions } from './prospects-bulk-actions';
import { ProspectsColumnsMenu } from './prospects-columns-menu';
import { ProspectsLiveRefresh } from './prospects-live-refresh';
import { useStoredColumnVisibility } from './use-stored-column-visibility';

export interface ProspectRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  found_email: string | null;
  email_checked_at?: string | null;
  is_chain: boolean;
  source: 'maps' | 'csv';
  excluded_at: string | null;
  created_at: string;
  campaign?: { id: string; name: string } | null;
}

export type { SortingState };

const COLUMN_SIZES: Record<ProspectColumnId, number> = {
  name: 260,
  category: 160,
  city: 130,
  rating: 80,
  reviews: 80,
  address: 240,
  phone: 150,
  website: 200,
  email: 200,
  source: 120,
  campaign: 180,
  date: 120,
};

/**
 * Tableau de prospects partagé (page Prospects, détail d'une campagne, plus
 * tard la validation des formulaires) : tri par en-tête, cases à cocher,
 * choix des colonnes mémorisé par organisation et actions groupées.
 *
 * Avec `onSortingChange`, le tri est délégué au parent (URL, requête serveur) ;
 * sans, les lignes sont triées sur place.
 */
export function ProspectsTable(props: {
  prospects: ProspectRow[];
  accountId: string;
  /** chemin des campagnes de l'organisation, pour les liens de la colonne « Campagne » */
  campaignsPath?: string;
  canDelete: boolean;
  sorting: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** colonnes retirées du tableau et du menu (ex. « Campagne » sur une campagne) */
  hiddenColumns?: ProspectColumnId[];
  /** appelé après une action groupée réussie (le parent rafraîchit ses données) */
  onMutated?: () => void;
  noResultsMessage?: React.ReactNode;
  /** campagnes du dossier (préparation des prospects importés sans campagne) */
  campaigns?: Array<{ id: string; name: string }>;
  formsHref?: string;
  /** dossier à suivre en temps réel (e-mails trouvés, prospects ajoutés) */
  liveSpaceId?: string;
  /** appelé à chaque changement en direct (liste chargée dans le navigateur) */
  onLiveChange?: () => void;
  /** false : le tableau est posé à ras bord dans un panneau qui dessine déjà le cadre */
  framed?: boolean;
}) {
  const t = useTranslations('prospects');
  const format = useFormatter();
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  // prospect ouvert dans le tiroir (relooking du 8/11/2026)
  const [openId, setOpenId] = useState<string | null>(null);
  const openProspect =
    props.prospects.find((prospect) => prospect.id === openId) ?? null;
  const framed = props.framed ?? true;

  const storageKey = prospectColumnsStorageKey(props.accountId);

  const { visibility, setVisibility, reset } = useStoredColumnVisibility(
    storageKey,
    DEFAULT_PROSPECT_COLUMN_VISIBILITY,
  );

  const hidden = useMemo(
    () => new Set(props.hiddenColumns ?? []),
    [props.hiddenColumns],
  );

  const columnIds = PROSPECT_COLUMN_IDS.filter((id) => !hidden.has(id));

  const columns = useMemo(
    () =>
      buildColumns({
        ids: columnIds,
        t,
        format,
        campaignsPath: props.campaignsPath,
        onOpen: setOpenId,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnIds.join(','), t, format, props.campaignsPath],
  );

  const selected = props.prospects.filter(
    (prospect) => rowSelection[prospect.id],
  );
  const clearSelection = () => setRowSelection({});
  const manualSorting = Boolean(props.onSortingChange);

  return (
    <div className={'flex flex-col gap-3'}>
      {props.liveSpaceId ? (
        <ProspectsLiveRefresh
          spaceId={props.liveSpaceId}
          paused={selected.length > 0}
          onChange={props.onLiveChange}
        />
      ) : null}

      <div
        className={cn('flex flex-wrap items-center justify-between gap-2', {
          'px-4 pt-3': !framed,
        })}
      >
        <div className={'min-w-0 flex-1'}>
          {selected.length > 0 ? (
            <ProspectsBulkActions
              accountId={props.accountId}
              selected={selected}
              canDelete={props.canDelete}
              onClear={clearSelection}
              onMutated={props.onMutated}
              campaigns={props.campaigns}
              formsHref={props.formsHref}
            />
          ) : null}
        </div>

        <ProspectsColumnsMenu
          columns={columnIds.map((id) => ({ id, label: t(`columns.${id}`) }))}
          visibility={visibility}
          onChange={setVisibility}
          onReset={reset}
        />
      </div>

      <div className={cn('overflow-x-auto', { 'rounded-lg border': framed })}>
        <DataTable
          // le tri contrôlé par l'URL doit resynchroniser l'état interne
          key={manualSorting ? JSON.stringify(props.sorting) : 'client'}
          data={props.prospects}
          columns={columns}
          getRowId={(row) => row.id}
          sorting={props.sorting}
          onSortingChange={props.onSortingChange}
          manualSorting={manualSorting}
          columnVisibility={visibility}
          onColumnVisibilityChange={setVisibility}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          tableProps={{ 'data-test': 'prospects-table' }}
          noResultsMessage={props.noResultsMessage}
        />
      </div>

      <ProspectDrawer
        prospect={openProspect}
        campaignsPath={props.campaignsPath}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </div>
  );
}

function buildColumns(params: {
  ids: ProspectColumnId[];
  t: ReturnType<typeof useTranslations<'prospects'>>;
  format: ReturnType<typeof useFormatter>;
  campaignsPath: string | undefined;
  /** ouvre la fiche du prospect dans le tiroir */
  onOpen: (id: string) => void;
}): ColumnDef<ProspectRow>[] {
  const { t, format } = params;

  const select: ColumnDef<ProspectRow> = {
    id: 'select',
    size: 36,
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label={t('selectAll')}
        data-test={'prospects-select-all'}
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onCheckedChange={(checked) =>
          table.toggleAllPageRowsSelected(checked === true)
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={t('selectRow')}
        data-test={'prospect-select'}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
      />
    ),
  };

  const definitions: Record<ProspectColumnId, ColumnDef<ProspectRow>> = {
    name: {
      id: 'name',
      accessorKey: 'name',
      header: t('columns.name'),
      cell: ({ row }) => {
        const prospect = row.original;

        return (
          <span
            className={'flex items-center gap-2 font-medium'}
            data-test={'prospect-name'}
          >
            <button
              type={'button'}
              className={
                'cursor-pointer truncate text-left underline-offset-4 hover:underline'
              }
              data-test={'prospect-open'}
              onClick={() => params.onOpen(prospect.id)}
            >
              {prospect.name}
            </button>

            {prospect.is_chain ? (
              <Badge variant={'outline'} data-test={'prospect-chain-badge'}>
                <Trans i18nKey={'prospects.chainBadge'} />
              </Badge>
            ) : null}

            {prospect.excluded_at ? (
              <Badge
                variant={'secondary'}
                data-test={'prospect-excluded-badge'}
              >
                <Trans i18nKey={'prospects.excludedBadge'} />
              </Badge>
            ) : null}
          </span>
        );
      },
    },
    category: {
      id: 'category',
      accessorKey: 'category',
      header: t('columns.category'),
      cell: ({ row }) => (
        <span className={'text-muted-foreground'}>
          {row.original.category ?? '–'}
        </span>
      ),
    },
    city: {
      id: 'city',
      accessorKey: 'city',
      header: t('columns.city'),
      cell: ({ row }) => row.original.city ?? '–',
    },
    rating: {
      id: 'rating',
      accessorKey: 'rating',
      header: t('columns.rating'),
      meta: { className: 'tabular-nums' },
      cell: ({ row }) =>
        row.original.rating === null
          ? '–'
          : format.number(row.original.rating, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }),
    },
    reviews: {
      id: 'reviews',
      accessorKey: 'review_count',
      header: t('columns.reviews'),
      meta: { className: 'tabular-nums' },
      cell: ({ row }) =>
        row.original.review_count === null
          ? '–'
          : format.number(row.original.review_count),
    },
    address: {
      id: 'address',
      accessorKey: 'address',
      header: t('columns.address'),
      cell: ({ row }) => (
        <span
          className={'block max-w-60 truncate'}
          title={row.original.address ?? ''}
        >
          {row.original.address ?? '–'}
        </span>
      ),
    },
    phone: {
      id: 'phone',
      accessorKey: 'phone',
      header: t('columns.phone'),
      cell: ({ row }) => (
        <span className={'whitespace-nowrap'}>{row.original.phone ?? '–'}</span>
      ),
    },
    website: {
      id: 'website',
      accessorKey: 'website',
      header: t('columns.website'),
      cell: ({ row }) => {
        const { website } = row.original;

        if (!website) {
          return '–';
        }

        const href = websiteHref(website);
        const label = websiteLabel(website, { keepPath: true });

        // valeur qui n'est pas une adresse http(s) : texte simple, jamais un lien
        if (!href) {
          return <span className={'block truncate'}>{label}</span>;
        }

        return (
          <a
            className={
              'inline-flex max-w-full items-center gap-1 hover:underline'
            }
            href={href}
            target={'_blank'}
            rel={'noopener noreferrer nofollow'}
          >
            <span className={'truncate'}>{label}</span>

            <ExternalLink className={'size-3 shrink-0'} />
          </a>
        );
      },
    },
    email: {
      id: 'email',
      accessorKey: 'found_email',
      header: t('columns.email'),
      cell: ({ row }) =>
        row.original.found_email ? (
          <a
            className={'hover:underline'}
            href={`mailto:${row.original.found_email}`}
          >
            {row.original.found_email}
          </a>
        ) : row.original.email_checked_at ? (
          <span className={'text-muted-foreground'}>{t('emailNotFound')}</span>
        ) : (
          '–'
        ),
    },
    source: {
      id: 'source',
      accessorKey: 'source',
      header: t('columns.source'),
      cell: ({ row }) => (
        <Badge variant={'secondary'}>
          <Trans i18nKey={`prospects.source.${row.original.source}`} />
        </Badge>
      ),
    },
    campaign: {
      id: 'campaign',
      accessorFn: (row) => row.campaign?.name ?? '',
      header: t('columns.campaign'),
      cell: ({ row }) => {
        const campaign = row.original.campaign;

        if (!campaign) return '–';

        if (!params.campaignsPath) return campaign.name;

        return (
          <Link
            className={'hover:underline'}
            href={`${params.campaignsPath}/${campaign.id}`}
          >
            {campaign.name}
          </Link>
        );
      },
    },
    date: {
      id: 'date',
      accessorKey: 'created_at',
      header: t('columns.date'),
      cell: ({ row }) => (
        <span className={'whitespace-nowrap'}>
          <LocalDateTime value={row.original.created_at} dateStyle={'medium'} />
        </span>
      ),
    },
  };

  return [
    select,
    ...params.ids.map((id) => ({
      ...definitions[id],
      size: COLUMN_SIZES[id],
      enableSorting: SORTABLE_PROSPECT_COLUMNS.has(id),
    })),
  ];
}
