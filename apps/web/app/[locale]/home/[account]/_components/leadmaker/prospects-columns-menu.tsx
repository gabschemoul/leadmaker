'use client';

import type { VisibilityState } from '@tanstack/react-table';
import { Columns3 } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { Trans } from '@kit/ui/trans';

/** Menu de choix des colonnes affichées. */
export function ProspectsColumnsMenu(props: {
  columns: Array<{ id: string; label: string }>;
  visibility: VisibilityState;
  onChange: (visibility: VisibilityState) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size={'sm'}
            variant={'outline'}
            data-test={'prospects-columns-menu'}
          />
        }
      >
        <Columns3 className={'w-4'} />

        <span>
          <Trans i18nKey={'prospects.columnsMenu.button'} />
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={'end'} className={'min-w-48'}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans i18nKey={'prospects.columnsMenu.label'} />
          </DropdownMenuLabel>

          {props.columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              closeOnClick={false}
              data-test={`prospects-column-toggle-${column.id}`}
              checked={props.visibility[column.id] !== false}
              onCheckedChange={(checked) =>
                props.onChange({ ...props.visibility, [column.id]: checked })
              }
            >
              {column.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          data-test={'prospects-columns-reset'}
          onClick={props.onReset}
        >
          <Trans i18nKey={'prospects.columnsMenu.reset'} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
