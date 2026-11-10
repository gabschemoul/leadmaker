/**
 * Rôle : pastille de filtre cliquable, calquée le 10/11/2026 sur les filtres d'ElevenLabs
 * (« Conversational », « Narration ») : 40 px, arrondi 12 px, fond transparent et filet à 10 % ;
 * active = filet noir renforcé (comme le filtre de langue choisi). Compteur discret à droite.
 * Composant serveur (lien). Écritures : aucune.
 */
import Link from 'next/link';

import { cn } from '@kit/ui/utils';

export function FilterChip(props: {
  href: string;
  active: boolean;
  label: React.ReactNode;
  count?: number | string;
  testId?: string;
}) {
  return (
    <Link
      href={props.href}
      aria-current={props.active ? 'page' : undefined}
      data-test={props.testId}
      className={cn(
        'text-foreground flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-[14px] font-medium whitespace-nowrap transition-colors duration-75',
        props.active
          ? 'border-foreground ring-foreground bg-foreground/[0.02] hover:bg-foreground/[0.043] ring-[0.5px]'
          : 'border-foreground/10 hover:bg-foreground/[0.043] active:bg-foreground/10',
      )}
    >
      <span>{props.label}</span>

      {props.count !== undefined ? (
        <span className={cn('text-xs tabular-nums', 'text-muted-foreground')}>
          {props.count}
        </span>
      ) : null}
    </Link>
  );
}
