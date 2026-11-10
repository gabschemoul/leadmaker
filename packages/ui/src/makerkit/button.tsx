/**
 * Prospectigo — boutons de l'appli. Depuis le 10/11/2026, le style vient tout entier de la primitive
 * shadcn (gabarits relevés sur ElevenLabs : voir `../shadcn/button.tsx`) ; cette enveloppe ne fait plus
 * que choisir la taille « pastille » pour la variante `chip`.
 * Le site vitrine a ses propres boutons en pilule (`PillLink`), il n'est pas concerné.
 */
import * as React from 'react';

import { Button as ShadcnButton, buttonVariants } from '../shadcn/button';

type ButtonProps = React.ComponentProps<typeof ShadcnButton>;

function Button({ variant = 'default', size, ...props }: ButtonProps) {
  return (
    <ShadcnButton
      variant={variant}
      size={size ?? (variant === 'chip' ? 'chip' : 'default')}
      {...props}
    />
  );
}

/** Variantes propres au projet, à appliquer par `className`. */
export const buttonExtras = {
  /** L'action principale de la page (noire, comme « Create Voice » d'ElevenLabs). */
  brand: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  /** Gabarit « Create Voice » pour l'action principale d'une page : 36 px, 14 px, arrondi 10 px. */
  pill: "h-9 gap-1.5 rounded-[10px] px-3 text-[14px] [&_svg:not([class*='size-'])]:size-[18px]",
} as const;

export type ButtonExtraVariant = keyof typeof buttonExtras;

export { Button, buttonVariants };
