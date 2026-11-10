import Link from 'next/link';

import { cn } from '@kit/ui/utils';

/**
 * Logo Prospectigo « i baguette » (validé par Gabriel le 10/11/2026, sa
 * « V2 ») : le i devient une baguette magique. La barre garde la couleur du
 * texte, le point devient une étoile bleue à 6 branches posée juste au-dessus.
 * L'ancien logo « le dernier o » est gardé dans app-logo-archive-dernier-o.tsx.
 *
 * Mesures en unités pour 1000 em, prises sur le i de la police des titres
 * (graisse 600) : chasse 212, barre de 120 × 496 (x de 46,3 à 166,3).
 * Étoile : 6 branches de 168 depuis le cœur, épaisseur 84, tournée de 30°
 * (deux branches couchées), cœur à 686 au-dessus de la ligne de base, ce qui
 * laisse un petit espace de 24 entre la barre et l'étoile. À droite du i,
 * -25 pour rapprocher le g.
 *
 * Le bleu est le bleu principal, y compris sur fond sombre (choix de Gabriel).
 */
const STAR_BLUE = '#3d3dff';

/** Les 6 branches de l'étoile, cœur en (0, 0), axe y vers le bas. */
const STAR_PATH =
  'M36.4 21 120.4 -124.5 47.6 -166.5 -36.4 -21Z' +
  'M0 42 168 42 168 -42 0 -42Z' +
  'M-36.4 21 47.6 166.5 120.4 124.5 36.4 -21Z' +
  'M-36.4 -21 -120.4 124.5 -47.6 166.5 36.4 21Z' +
  'M0 -42 -168 -42 -168 42 0 42Z' +
  'M36.4 -21 -47.6 -166.5 -120.4 -124.5 -36.4 21Z';

/** Le i en baguette, à placer dans le texte du nom (posé sur la ligne de base). */
export function LogoWand({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={'0 -853 212 853'}
      className={cn(
        'inline-block h-[0.853em] w-[0.212em] shrink-0 overflow-visible align-baseline',
        className,
      )}
      style={{ marginRight: '-0.025em' }}
    >
      <rect x={46.29} y={-496} width={120} height={496} fill={'currentColor'} />
      <path
        d={STAR_PATH}
        transform={'translate(106.29 -686.28)'}
        fill={STAR_BLUE}
      />
    </svg>
  );
}

/** L'étoile seule : symbole du logo (barre latérale repliée, icônes). */
export function LogoStar({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={'-170 -170 340 340'}
      className={cn('inline-block size-[0.8em] shrink-0', className)}
    >
      <path d={STAR_PATH} fill={STAR_BLUE} />
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
        'text-foreground font-heading inline-block text-[1.375rem] leading-none font-semibold tracking-[-0.025em] whitespace-nowrap select-none',
        className,
      )}
    >
      <span aria-hidden className={'group-data-[collapsible=icon]:hidden'}>
        Prospect
        <LogoWand />
        go
      </span>
      <LogoStar
        className={
          'hidden align-middle group-data-[collapsible=icon]:inline-block'
        }
      />
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
