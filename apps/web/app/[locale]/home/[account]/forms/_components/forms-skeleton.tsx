/**
 * Silhouette de la page Formulaires pendant le premier chargement (10/11/2026) : même cadre que la page (texte
 * d'introduction, pastilles des onglets, phrase d'aide, tableau), pour que seule la liste semble se charger.
 * Composant serveur, sans données.
 */
import { Card, CardContent, CardHeader } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

const PILL_WIDTHS = [
  'w-20',
  'w-28',
  'w-40',
  'w-24',
  'w-32',
  'w-44',
  'w-28',
  'w-24',
];
const COLUMN_WIDTHS = ['w-40', 'w-32', 'w-24', 'w-20', 'w-28'];

export function FormsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card aria-busy={true} data-test={'forms-skeleton'}>
      <CardHeader className={'flex flex-col gap-4'}>
        <div className={'flex max-w-2xl flex-col gap-2'}>
          <Skeleton className={'h-3.5 w-full'} />
          <Skeleton className={'h-3.5 w-2/3'} />
        </div>

        <div className={'flex flex-wrap items-center gap-2'}>
          {PILL_WIDTHS.map((width, index) => (
            <Skeleton key={index} className={`h-8 rounded-full ${width}`} />
          ))}
        </div>

        <Skeleton className={'h-3.5 w-80'} />
      </CardHeader>

      <CardContent>
        <div className={'rounded-lg border'}>
          <div className={'flex items-center gap-6 border-b px-4 py-3'}>
            {COLUMN_WIDTHS.map((width, index) => (
              <Skeleton key={index} className={`h-3 ${width}`} />
            ))}
          </div>

          {Array.from({ length: rows }).map((_, row) => (
            <div
              key={row}
              className={
                'flex h-14 items-center gap-6 border-b px-4 last:border-b-0'
              }
            >
              {COLUMN_WIDTHS.map((width, index) => (
                <Skeleton key={index} className={`h-3.5 ${width}`} />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
