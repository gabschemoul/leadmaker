/**
 * Prospectigo (8/11/2026) — tableaux façon Apollo : en-tête gris pierre avec étiquettes en
 * capitales (11 px, chasse fixe), lignes de 48 px en 13 px, filets fins.
 * Enveloppe la primitive shadcn (laissée intacte) ; `cn()` fait gagner le `className` du point d'appel.
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import {
  Table as ShadcnTable,
  TableBody,
  TableCaption,
  TableCell as ShadcnTableCell,
  TableFooter,
  TableHead as ShadcnTableHead,
  TableHeader as ShadcnTableHeader,
  TableRow,
} from '../shadcn/table';

function Table({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnTable>) {
  return <ShadcnTable className={cn('text-[13px]', className)} {...props} />;
}

function TableHeader({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnTableHeader>) {
  return (
    <ShadcnTableHeader
      className={cn(
        'bg-stone-50 dark:bg-stone-900 [&_tr]:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnTableHead>) {
  return (
    <ShadcnTableHead
      className={cn(
        'text-muted-foreground h-10 px-3 font-mono text-[11px] font-medium tracking-[0.06em] uppercase',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnTableCell>) {
  return (
    <ShadcnTableCell className={cn('h-12 px-3 py-2', className)} {...props} />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
