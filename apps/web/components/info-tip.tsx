'use client';

import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { cn } from '@kit/ui/utils';

/**
 * Masqué pour l'instant (choix de Gabriel, 10/11/2026) : les « i » restent en place dans le code,
 * repasser à `true` pour les réafficher partout d'un coup.
 */
const SHOW_INFO_TIPS = false;

/**
 * Petit « i » entouré : l'explication s'affiche dans une bulle au survol (ordinateur)
 * ou à l'appui (téléphone). Ménage du 10/11/2026 : les textes d'aide ne sont plus
 * affichés d'office, pour que les pages restent lisibles.
 */
export function InfoTip(props: {
  children: React.ReactNode;
  label?: string;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  if (!SHOW_INFO_TIPS) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={100}
        closeDelay={100}
        aria-label={props.label ?? 'Plus d’informations'}
        data-test={'info-tip'}
        className={cn(
          'text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle transition-colors outline-none focus-visible:ring-2',
          props.className,
        )}
      >
        <Info className={'size-4'} strokeWidth={1.75} />
      </PopoverTrigger>

      <PopoverContent
        side={props.side ?? 'top'}
        className={'text-muted-foreground w-72 p-3 text-[13px] leading-5'}
      >
        {props.children}
      </PopoverContent>
    </Popover>
  );
}
