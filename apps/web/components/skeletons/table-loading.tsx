'use client';

/**
 * Tableau en cours de chargement (10/11/2026, règle « tout le statique s'affiche tout de suite ») : le vrai champ
 * de recherche et les vrais titres de colonnes (même DataTable que le tableau final), seules les lignes sont des
 * silhouettes. Sert de fallback de Suspense là où seules les lignes viennent de la base.
 *
 * `headers` et `searchPlaceholder` sont des clés de traduction complètes (« teams.memberName »).
 */
import { useMemo } from 'react';

import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';

import { DataTable } from '@kit/ui/data-table';
import { Input } from '@kit/ui/input';
import { Skeleton } from '@kit/ui/skeleton';

const CELL_WIDTHS = ['w-40', 'w-48', 'w-24', 'w-28', 'w-20', 'w-16'];

export function TableLoading(props: {
  headers: string[];
  searchPlaceholder?: string;
  rows?: number;
}) {
  const t = useTranslations();

  const columns = useMemo<ColumnDef<number>[]>(
    () =>
      props.headers.map((key, index) => ({
        id: `col-${index}`,
        header: key ? t(key) : '',
        cell: () => (
          <Skeleton
            className={`h-4 ${CELL_WIDTHS[index % CELL_WIDTHS.length]}`}
          />
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.headers.join('|'), t],
  );

  const data = useMemo(
    () => Array.from({ length: props.rows ?? 3 }, (_, index) => index),
    [props.rows],
  );

  return (
    <div className={'flex flex-col space-y-2'} aria-busy={true}>
      {props.searchPlaceholder ? (
        <Input disabled placeholder={t(props.searchPlaceholder)} />
      ) : null}

      <DataTable columns={columns} data={data} />
    </div>
  );
}
