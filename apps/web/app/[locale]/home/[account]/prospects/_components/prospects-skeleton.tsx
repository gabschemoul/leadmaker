/**
 * Page Prospects pendant le premier chargement (10/11/2026, règle « tout le statique s'affiche tout de suite ») :
 * vraie barre de recherche, vrais boutons (campagnes, activité, ville, filtres, importer, exporter, colonnes) et
 * vrais titres des colonnes affichées par défaut ; seules les lignes et le total attendent la base.
 * Composant serveur, sans données.
 */
import {
  ChevronDown,
  Columns3,
  Download,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
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
  DEFAULT_PROSPECT_COLUMN_VISIBILITY,
  PROSPECT_COLUMN_IDS,
} from '../../_components/leadmaker/prospect-columns';
import { ProspectsSearchLoading } from './prospects-search-loading';

const VISIBLE_COLUMNS = PROSPECT_COLUMN_IDS.filter(
  (id) => DEFAULT_PROSPECT_COLUMN_VISIBILITY[id] !== false,
);

const CELL_WIDTHS: Record<string, string> = {
  name: 'w-44',
  category: 'w-28',
  city: 'w-24',
  rating: 'w-10',
  reviews: 'w-10',
  phone: 'w-28',
  website: 'w-32',
  email: 'w-36',
  date: 'w-20',
};

export function ProspectsSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <Card
      className={'gap-0 py-0'}
      aria-busy={true}
      data-test={'prospects-skeleton'}
    >
      <CardHeader
        className={
          'flex flex-col gap-3 border-b px-4 py-3 xl:flex-row xl:items-start xl:justify-between'
        }
      >
        <div className={'flex flex-wrap items-center gap-2'}>
          <div className={'relative'}>
            <Search
              className={
                'text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
              }
            />

            <ProspectsSearchLoading />
          </div>

          <FakeButton>
            <Trans i18nKey={'prospects.filters.campaignAll'} />
            <ChevronDown className={'size-4 opacity-60'} />
          </FakeButton>

          <FakeButton>
            <Trans i18nKey={'prospects.filters.category'} />
            <ChevronDown className={'size-4 opacity-60'} />
          </FakeButton>

          <FakeButton>
            <Trans i18nKey={'prospects.filters.city'} />
            <ChevronDown className={'size-4 opacity-60'} />
          </FakeButton>

          <FakeButton>
            <SlidersHorizontal className={'w-4'} />
            <Trans i18nKey={'prospects.filters.more'} />
          </FakeButton>
        </div>

        <div className={'flex shrink-0 gap-2'}>
          <FakeButton>
            <Upload className={'w-4'} />
            <Trans i18nKey={'campaigns.import.button'} />
          </FakeButton>

          <FakeButton>
            <Download className={'w-4'} />
            <Trans i18nKey={'prospects.export.all'} />
          </FakeButton>
        </div>
      </CardHeader>

      <CardContent className={'flex flex-col gap-0 px-0'}>
        <div className={'flex justify-end px-4 pt-3 pb-3'}>
          <FakeButton>
            <Columns3 className={'w-4'} />
            <Trans i18nKey={'prospects.columnsMenu.button'} />
          </FakeButton>
        </div>

        <div className={'overflow-x-auto'}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={'w-8'}>
                  <Skeleton className={'size-4 rounded-sm'} />
                </TableHead>
                {VISIBLE_COLUMNS.map((id) => (
                  <TableHead key={id}>
                    <Trans i18nKey={`prospects.columns.${id}`} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {Array.from({ length: rows }).map((_, row) => (
                <TableRow key={row} className={'[&>td]:h-12'}>
                  <TableCell>
                    <Skeleton className={'size-4 rounded-sm'} />
                  </TableCell>
                  {VISIBLE_COLUMNS.map((id) => (
                    <TableCell key={id}>
                      <Skeleton
                        className={`h-3.5 ${CELL_WIDTHS[id] ?? 'w-20'}`}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div
          className={'flex items-center justify-between border-t px-4 py-2.5'}
        >
          <Skeleton className={'h-3.5 w-32'} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Bouton au même dessin que les vrais, inactif le temps du chargement. */
function FakeButton(props: React.PropsWithChildren) {
  return (
    <Button size={'sm'} variant={'outline'} disabled className={'opacity-100'}>
      {props.children}
    </Button>
  );
}
