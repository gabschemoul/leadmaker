/**
 * Rôle : pastille de filtre cliquable (relooking du 8/11/2026, charte du site) — blanche avec un
 * contour fin, bleu pâle avec le texte bleu quand elle est active, compteur discret à droite.
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
        'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
        props.active
          ? 'bg-brand-pale text-brand-hover dark:text-brand'
          : 'bg-card text-foreground ring-pill-ring shadow-soft hover:bg-muted ring-[0.5px]',
      )}
    >
      <span>{props.label}</span>

      {props.count !== undefined ? (
        <span
          className={cn(
            'text-xs tabular-nums',
            props.active ? 'opacity-70' : 'text-muted-foreground',
          )}
        >
          {props.count}
        </span>
      ) : null}
    </Link>
  );
}
