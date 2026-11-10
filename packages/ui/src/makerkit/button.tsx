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
      // tous les boutons au gabarit « Feedback » (32 px) ; `size="lg"` (« Create Voice », 36 px) se pose
      // à la main, sur toute une rangée à la fois pour que les boutons voisins aient la même hauteur
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

/**
 * Pastille de filtre façon ElevenLabs (« Conversational », « Narration ») pour les éléments qui ne sont
 * pas des `<Button>` (liens, boutons maison) : 40 px, arrondi 12 px, filet à 10 % ; active = filet noir
 * renforcé, comme le filtre de langue choisi.
 */
export function chipClasses(active: boolean) {
  return [
    'text-foreground flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[14px] font-medium whitespace-nowrap transition-colors duration-75',
    active
      ? 'border-foreground ring-foreground bg-foreground/[0.02] hover:bg-foreground/[0.043] ring-[0.5px]'
      : 'border-foreground/10 hover:bg-foreground/[0.043] active:bg-foreground/10',
  ].join(' ');
}

export type ButtonExtraVariant = keyof typeof buttonExtras;

export { Button, buttonVariants };
