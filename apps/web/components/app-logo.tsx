import Link from 'next/link';

import { cn } from '@kit/ui/utils';

/**
 * Logo Prospectigo « Le repère » (choisi le 2/11/2026), dans l'esprit du logo
 * d'ElevenLabs : un symbole fait avec les lettres elles-mêmes. Une barre
 * surmontée d'un point orange (l'épingle Google Maps réduite au minimum),
 * posée devant le nom.
 *
 * Les proportions sont mesurées sur Host Grotesk graisse 600 (unités pour
 * 1000 em) : hauteur des capitales 700, épaisseur du fût 120. Le point fait
 * 2,15 fûts de diamètre, l'espace au-dessus de la barre 0,55 fût, l'espace
 * avant le nom 1,45 fût. Les mêmes chiffres servent aux icônes (favicon) et
 * aux e-mails.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={'0 0 258 700'}
      className={cn('h-[0.7em] w-[0.258em] shrink-0', className)}
    >
      <circle cx={129} cy={129} r={129} className={'fill-brand'} />
      <rect x={69} y={324} width={120} height={376} fill={'currentColor'} />
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
      <LogoMark className={'mr-[0.174em]'} />
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
