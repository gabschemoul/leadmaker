/**
 * Page Formulaires pendant le premier chargement (10/11/2026, règle « tout le statique s'affiche tout de
 * suite ») : vrai texte d'introduction, vrais noms des onglets toujours présents, vrais titres de colonnes ;
 * seuls les nombres et les lignes attendent la base. Composant serveur, sans données.
 */
import { chipClasses } from '@kit/ui/button-extras';
import { Card, CardContent, CardDescription, CardHeader } from '@kit/ui/card';
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

import { ALWAYS_VISIBLE_GROUPS } from '~/lib/leadmaker/attempts';

const COLUMNS = [
  'company',
  'status',
  'message',
  'detail',
  'screenshot',
  'preparedAt',
];

const CELL_WIDTHS = ['w-40', 'w-24', 'w-28', 'w-32', 'w-16', 'w-20'];

export function FormsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card aria-busy={true} data-test={'forms-skeleton'}>
      <CardHeader className={'flex flex-col gap-4'}>
        <CardDescription className={'max-w-2xl'}>
          <Trans i18nKey={'outreach.forms.intro'} />
        </CardDescription>

        <div className={'flex flex-wrap items-center gap-2'}>
          {ALWAYS_VISIBLE_GROUPS.map((group, index) => (
            <span key={group} className={chipClasses(index === 0)}>
              <Trans i18nKey={`outreach.forms.groups.${group}`} />
            </span>
          ))}
        </div>

        <Skeleton className={'h-3.5 w-80'} />
      </CardHeader>

      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={'w-8'} />
              {COLUMNS.map((column) => (
                <TableHead key={column}>
                  <Trans i18nKey={`outreach.forms.columns.${column}`} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {Array.from({ length: rows }).map((_, row) => (
              <TableRow key={row} className={'[&>td]:h-14'}>
                <TableCell>
                  <Skeleton className={'size-4 rounded-sm'} />
                </TableCell>
                {CELL_WIDTHS.map((width, index) => (
                  <TableCell key={index}>
                    <Skeleton className={`h-3.5 ${width}`} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
