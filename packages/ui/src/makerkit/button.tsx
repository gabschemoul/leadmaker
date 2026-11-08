/**
 * Prospectigo (8/11/2026) — boutons de l'appli dans la charte du site : toujours en pilule,
 * noir plein pour l'action neutre, blanc avec un contour de 0,5 px et une ombre très douce pour
 * le secondaire (`outline`), bleu Klein pour l'action principale (`buttonExtras.brand`).
 * Enveloppe la primitive shadcn (laissée intacte) ; `cn()` fait gagner le `className` du point d'appel.
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { Button as ShadcnButton, buttonVariants } from '../shadcn/button';

type ButtonProps = React.ComponentProps<typeof ShadcnButton>;

function Button({ className, variant = 'default', ...props }: ButtonProps) {
  return (
    <ShadcnButton
      variant={variant}
      className={cn(
        'rounded-full',
        variant === 'outline' &&
          'ring-pill-ring shadow-soft hover:bg-background dark:bg-card dark:hover:bg-secondary border-transparent ring-[0.5px] dark:border-transparent',
        className,
      )}
      {...props}
    />
  );
}

/** Variantes propres au projet, à appliquer par `className`. */
export const buttonExtras = {
  /** L'action principale de la page, en bleu Klein (une seule par écran). */
  brand: 'bg-brand text-brand-foreground hover:bg-brand-hover',
  /** Pilule un peu plus haute pour l'action principale d'une page. */
  pill: 'h-9 px-4 text-sm',
} as const;

export type ButtonExtraVariant = keyof typeof buttonExtras;

export { Button, buttonVariants };
