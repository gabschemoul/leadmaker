import { cn } from '@kit/ui/utils';

import { Band, DisplayTitle } from './el';

/**
 * En-tête des pages secondaires, façon ElevenLabs : grand titre fin à gauche,
 * phrase d'intro à droite. `container` est gardé pour les appels existants.
 */
export function SitePageHeader({
  title,
  subtitle,
  className = '',
}: {
  title: string;
  subtitle: string;
  container?: boolean;
  className?: string;
}) {
  return (
    <Band topRule={false} className={className}>
      <div
        className={cn(
          'grid gap-x-12 gap-y-4 pt-16 pb-12 sm:px-7 md:grid-cols-2 md:items-end md:pt-24 md:pb-16',
        )}
      >
        <DisplayTitle as={'h1'} size={'page'}>
          {title}
        </DisplayTitle>

        <p
          className={
            'text-muted-foreground text-base leading-[1.5] tracking-[0.01em] md:pb-1.5 md:text-[1.0625rem]'
          }
        >
          {subtitle}
        </p>
      </div>
    </Band>
  );
}
