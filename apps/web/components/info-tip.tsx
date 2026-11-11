'use client';

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
  /** affiché même quand les « i » sont masqués (demandé explicitement à cet endroit) */
  always?: boolean;
}) {
  if (!SHOW_INFO_TIPS && !props.always) {
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
          'bg-foreground/[0.07] text-muted-foreground hover:bg-foreground/[0.12] hover:text-foreground data-[popup-open]:bg-foreground/[0.12] data-[popup-open]:text-foreground focus-visible:ring-ring inline-flex size-[18px] shrink-0 cursor-help items-center justify-center rounded-full align-middle transition-colors outline-none focus-visible:ring-2',
          props.className,
        )}
      >
        {/* « i » dessiné (11/11 : l'icône cerclée de lucide ne plaisait pas) : pastille pleine, point + trait arrondis */}
        <svg aria-hidden viewBox={'0 0 16 16'} className={'size-3'}>
          <circle cx={8} cy={3.6} r={1.35} fill={'currentColor'} />
          <path
            d={'M8 7v5.6'}
            stroke={'currentColor'}
            strokeWidth={2}
            strokeLinecap={'round'}
          />
        </svg>
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
