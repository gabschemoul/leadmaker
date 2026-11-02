import Link from 'next/link';

import { cn } from '@kit/ui/utils';

/**
 * Logo Prospectigo « Le repère » (choisi le 2/11/2026, version validée sur
 * le téléphone de Gabriel) : un gros point orange posé au-dessus d'un petit
 * trait, comme une épingle au-dessus de son point d'ancrage, devant le nom.
 *
 * Proportions en unités pour 1000 em (Host Grotesk 600, capitales = 700) :
 * point de 498 de diamètre aligné sur le haut des capitales, trait de
 * 234 × 62 posé sur la ligne de base, 373 d'espace avant le nom. Les mêmes
 * chiffres servent aux icônes (favicon) et aux e-mails.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={'0 0 498 700'}
      className={cn('h-[0.7em] w-[0.498em] shrink-0', className)}
    >
      <circle cx={249} cy={249} r={249} className={'fill-brand'} />
      <rect x={132} y={638} width={234} height={62} fill={'currentColor'} />
    </svg>
  );
}

export function LogoImage({
  className,
}: {
  className?: string;
  width?: number;
}) {
  return (
    <span
      className={cn(
        'text-foreground in-data-[sidebar=sidebar]:text-sidebar-accent-foreground font-heading inline-flex items-baseline text-[1.375rem] leading-none font-semibold tracking-[-0.025em] select-none',
        className,
      )}
    >
      <LogoMark className={'mr-[0.373em]'} />
      Prospectigo
    </span>
  );
}

export function AppLogo({
  href,
  label,
  className,
}: {
  href?: string | null;
  className?: string;
  label?: string;
}) {
  if (href === null) {
    return <LogoImage className={className} />;
  }

  return (
    <Link
      aria-label={label ?? 'Home Page'}
      href={href ?? '/'}
      className="mx-auto md:mx-0"
    >
      <LogoImage className={className} />
    </Link>
  );
}
