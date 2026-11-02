import Link from 'next/link';

import { cn } from '@kit/ui/utils';

/**
 * Logo texte « Prospectigo » (le visuel définitif viendra avec la passe
 * design). `width` est gardé pour les appels existants.
 */
export function LogoImage({
  className,
}: {
  className?: string;
  width?: number;
}) {
  return (
    <span
      className={cn(
        'text-foreground in-data-[sidebar=sidebar]:text-sidebar-accent-foreground font-heading inline-flex items-baseline text-[1.375rem] leading-none font-medium tracking-[-0.03em] select-none',
        className,
      )}
    >
      Prospectigo
      <span
        className={'bg-brand ml-[3px] inline-block size-[5px] rounded-full'}
      />
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
