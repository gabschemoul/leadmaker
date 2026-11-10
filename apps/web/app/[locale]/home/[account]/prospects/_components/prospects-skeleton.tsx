/**
 * Silhouette du panneau Prospects pendant le premier chargement (10/11/2026) : même cadre que ProspectsBrowser
 * (barre de filtres, boutons Importer / Exporter, en-tête du tableau, lignes, pied avec le total), pour que
 * seule la liste semble se charger. Composant serveur, sans données.
 */
import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

const COLUMN_WIDTHS = ['w-40', 'w-24', 'w-20', 'w-14', 'w-16', 'w-32', 'w-24'];

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
        {/* recherche, campagne, activité, ville, filtres */}
        <div className={'flex flex-wrap items-center gap-2'}>
          <Skeleton className={'h-8 w-56 rounded-md md:w-72'} />
          <Skeleton className={'h-8 w-36 rounded-md'} />
          <Skeleton className={'h-8 w-28 rounded-md'} />
          <Skeleton className={'h-8 w-24 rounded-md'} />
          <Skeleton className={'h-8 w-24 rounded-md'} />
        </div>

        {/* importer, exporter */}
        <div className={'flex shrink-0 gap-2'}>
          <Skeleton className={'h-8 w-28 rounded-md'} />
          <Skeleton className={'h-8 w-36 rounded-md'} />
        </div>
      </CardHeader>

      <CardContent className={'flex flex-col gap-0 px-0'}>
        {/* menu des colonnes */}
        <div className={'flex justify-end px-4 pt-3 pb-3'}>
          <Skeleton className={'h-8 w-28 rounded-md'} />
        </div>

        <div className={'border-t'}>
          <div className={'flex items-center gap-6 border-b px-4 py-3'}>
            <Skeleton className={'size-4 rounded-sm'} />
            {COLUMN_WIDTHS.map((width, index) => (
              <Skeleton key={index} className={`h-3 ${width}`} />
            ))}
          </div>

          {Array.from({ length: rows }).map((_, row) => (
            <div
              key={row}
              className={
                'flex h-12 items-center gap-6 border-b px-4 last:border-b-0'
              }
            >
              <Skeleton className={'size-4 rounded-sm'} />
              {COLUMN_WIDTHS.map((width, index) => (
                <Skeleton key={index} className={`h-3.5 ${width}`} />
              ))}
            </div>
          ))}
        </div>

        <div
          className={'flex items-center justify-between border-t px-4 py-2.5'}
        >
          <Skeleton className={'h-3.5 w-32'} />
          <Skeleton className={'h-8 w-56 rounded-md'} />
        </div>
      </CardContent>
    </Card>
  );
}
