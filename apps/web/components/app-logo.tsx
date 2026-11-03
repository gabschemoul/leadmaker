import Link from 'next/link';

import { cn } from '@kit/ui/utils';

/**
 * Logo Prospectigo « le dernier o » (choisi le 3/11/2026 par Nath, à
 * l'essai sur staging) : le o final du nom devient un rond orange, avec un
 * petit trait en dessous, comme une épingle au-dessus de son point d'ancrage.
 *
 * Le rond prend exactement la place du vrai o de la police (Host Grotesk 600,
 * en unités pour 1000 em) : 576 de chasse, 520 de diamètre, du haut du o
 * (508 au-dessus de la ligne de base) à 12 en dessous. Le trait de 244 × 65
 * est 146 plus bas, il descend à 223 sous la ligne de base, comme le g. Ce
 * sont les proportions de l'ancien symbole (rond 498, trait 234 × 62, écart
 * 140) : les icônes (favicon) restent donc valables.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={'0 0 576 731'}
      className={cn(
        'inline-block h-[0.731em] w-[0.576em] shrink-0 overflow-visible align-[-0.223em]',
        className,
      )}
    >
      <circle cx={288} cy={260} r={260} className={'fill-brand'} />
      <rect x={166} y={666} width={244} height={65} fill={'currentColor'} />
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
      role={'img'}
      aria-label={'Prospectigo'}
      className={cn(
        'text-foreground in-data-[sidebar=sidebar]:text-sidebar-accent-foreground font-heading inline-block text-[1.375rem] leading-none font-semibold tracking-[-0.025em] whitespace-nowrap select-none',
        className,
      )}
    >
      <span aria-hidden className={'group-data-[collapsible=icon]:hidden'}>
        Prospectig
      </span>
      <LogoMark />
    </span>
  );
}

export function AppLogo({
  href,
  label,
  className,
  linkClassName = 'mx-auto md:mx-0',
}: {
  href?: string | null;
  className?: string;
  label?: string;
  linkClassName?: string;
}) {
  if (href === null) {
    return <LogoImage className={className} />;
  }

  return (
    <Link
      aria-label={label ?? 'Home Page'}
      href={href ?? '/'}
      className={linkClassName}
    >
      <LogoImage className={className} />
    </Link>
  );
}
