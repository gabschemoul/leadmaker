/**
 * Prospectigo (8/11/2026) — pastilles dans la charte du site (fenêtre d'appli de la page d'accueil) :
 * petit rectangle arrondi de 6 px, 24 px de haut, texte 12 px. `default` = bleu pâle sur texte bleu,
 * `secondary` = crème, `outline` = blanc avec un filet. Enveloppe la primitive shadcn (laissée intacte).
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { Badge as ShadcnBadge, badgeVariants } from '../shadcn/badge';

type BadgeProps = React.ComponentProps<typeof ShadcnBadge>;

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <ShadcnBadge
      variant={variant}
      className={cn(
        'h-6 rounded-md px-2.5 py-0',
        variant === 'default' &&
          'bg-brand-pale text-brand-hover dark:text-brand [a]:hover:bg-brand-pale/80',
        variant === 'secondary' && 'bg-muted text-foreground',
        variant === 'outline' &&
          'bg-card ring-border [a]:hover:bg-muted border-transparent ring-1',
        className,
      )}
      {...props}
    />
  );
}

/** Variantes propres au projet, à appliquer par `className`. */
export const badgeExtras = {
  /** Bleu plein (« envoyé » dans la fenêtre d'appli du site). */
  info: 'bg-brand text-brand-foreground [a]:hover:bg-brand/90',
  /** Vert « trouvé / terminé ». */
  success: 'bg-ok-pale text-ok [&>svg]:text-ok',
  warning:
    'bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 [&>svg]:text-amber-600',
  /** Bleu pâle sur texte bleu (identique à `default`, gardé pour les points d'appel existants). */
  brand: 'bg-brand-pale text-brand-hover dark:text-brand [&>svg]:text-brand',
  /** Point coloré devant le texte (statut dans un tableau). */
  dot: 'before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-[""]',
} as const;

export type BadgeExtraVariant = keyof typeof badgeExtras;

export { Badge, badgeVariants };
