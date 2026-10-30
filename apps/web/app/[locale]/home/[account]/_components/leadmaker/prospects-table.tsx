'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';

import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ExternalLink } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@kit/ui/badge';
import { Checkbox } from '@kit/ui/checkbox';
import { DataTable } from '@kit/ui/enhanced-data-table';
import { Trans } from '@kit/ui/trans';

import {
  DEFAULT_PROSPECT_COLUMN_VISIBILITY,
  PROSPECT_COLUMN_IDS,
  type ProspectColumnId,
  SORTABLE_PROSPECT_COLUMNS,
  prospectColumnsStorageKey,
} from './prospect-columns';
import { ProspectsBulkActions } from './prospects-bulk-actions';
import { ProspectsColumnsMenu } from './prospects-columns-menu';
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

function websiteHref(website: string) {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function websiteLabel(website: string) {
  return website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

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
}) {
  const t = useTranslations('prospects');
  const format = useFormatter();
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

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
      <div className={'flex flex-wrap items-center justify-between gap-2'}>
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

      <div className={'overflow-x-auto rounded-lg border'}>
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
    </div>
  );
}

function buildColumns(params: {
  ids: ProspectColumnId[];
  t: ReturnType<typeof useTranslations<'prospects'>>;
  format: ReturnType<typeof useFormatter>;
  campaignsPath: string | undefined;
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
            {prospect.website ? (
              <a
                className={'truncate hover:underline'}
                href={websiteHref(prospect.website)}
                target={'_blank'}
                rel={'noopener noreferrer nofollow'}
              >
                {prospect.name}
              </a>
            ) : (
              <span className={'truncate'}>{prospect.name}</span>
            )}

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
      cell: ({ row }) =>
        row.original.website ? (
          <a
            className={
              'inline-flex max-w-full items-center gap-1 hover:underline'
            }
            href={websiteHref(row.original.website)}
            target={'_blank'}
            rel={'noopener noreferrer nofollow'}
          >
            <span className={'truncate'}>
              {websiteLabel(row.original.website)}
            </span>

            <ExternalLink className={'size-3 shrink-0'} />
          </a>
        ) : (
          '–'
        ),
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
          {format.dateTime(new Date(row.original.created_at), {
            dateStyle: 'medium',
          })}
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
