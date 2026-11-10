/**
 * Prospectigo (8/11/2026) — tableaux dans la charte du site (fenêtre d'appli de la page
 * d'accueil) : en-tête en petites capitales à chasse fixe, gris ; lignes de 48 px en 14 px ;
 * filets fins ; le cadre blanc arrondi vient du panneau qui contient le tableau.
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
  return <ShadcnTable className={cn('text-sm', className)} {...props} />;
}

function TableHeader({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnTableHeader>) {
  return (
    <ShadcnTableHeader
      className={cn('[&_tr]:hover:bg-transparent', className)}
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
        'text-muted-foreground h-10 px-4 font-mono text-[12px] font-medium tracking-[0.06em] uppercase',
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
    <ShadcnTableCell className={cn('h-12 px-4 py-2', className)} {...props} />
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
