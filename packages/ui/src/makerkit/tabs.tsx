'use client';

/**
 * Prospectigo (8/11/2026) — onglets dans la charte du site (fenêtre d'appli de la page d'accueil) :
 * petites pastilles crème de 32 px, arrondies à 8 px, l'onglet actif en noir sur blanc. La variante
 * `line` (soulignée) reste celle de shadcn. Enveloppe la primitive shadcn (laissée intacte).
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import {
  Tabs,
  TabsContent,
  TabsList as ShadcnTabsList,
  TabsTrigger as ShadcnTabsTrigger,
  tabsListVariants,
} from '../shadcn/tabs';

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof ShadcnTabsList>) {
  return (
    <ShadcnTabsList
      variant={variant}
      className={cn(
        variant === 'default' &&
          'h-auto gap-1.5 rounded-none bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnTabsTrigger>) {
  return (
    <ShadcnTabsTrigger
      className={cn(
        'group-data-[variant=default]/tabs-list:bg-muted group-data-[variant=default]/tabs-list:text-foreground/70 group-data-[variant=default]/tabs-list:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:bg-foreground group-data-[variant=default]/tabs-list:data-active:text-background dark:group-data-[variant=default]/tabs-list:data-active:bg-foreground dark:group-data-[variant=default]/tabs-list:data-active:text-background group-data-[variant=default]/tabs-list:h-8 group-data-[variant=default]/tabs-list:flex-none group-data-[variant=default]/tabs-list:rounded-lg group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:text-[13px] group-data-[variant=default]/tabs-list:data-active:shadow-none dark:group-data-[variant=default]/tabs-list:data-active:border-transparent',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
