import Link from 'next/link';

import { cn } from '@kit/ui/utils';

/**
 * Briques du site vitrine, DA « façon ElevenLabs » (relooking du 2/11/2026).
 *
 * - Boutons toujours en pilule : noir plein pour l'action principale, blanc
 *   avec un contour de 0,5 px et une ombre très douce pour le reste.
 * - Sections : colonne centrale de 62rem bordée de filets verticaux presque
 *   invisibles, séparées par un filet horizontal avec un point à chaque coin.
 */

type PillVariant = 'primary' | 'secondary';
type PillSize = 'lg' | 'md' | 'sm';

export function pillButtonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: PillVariant;
  size?: PillSize;
  className?: string;
} = {}) {
  return cn(
    'inline-flex items-center justify-center gap-x-2 rounded-full font-sans font-normal whitespace-nowrap outline-none select-none',
    'transition-[background-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] active:scale-[0.98]',
    'focus-visible:outline-focus focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-solid',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    {
      'h-11 px-5 text-base': size === 'lg',
      'h-9 px-3.5 text-sm': size === 'md',
      'h-8 px-3 text-[0.8125rem]': size === 'sm',
      'bg-primary text-primary-foreground hover:bg-primary-hover':
        variant === 'primary',
      'bg-card text-foreground ring-pill-ring shadow-soft hover:bg-background dark:hover:bg-secondary ring-[0.5px]':
        variant === 'secondary',
    },
    className,
  );
}

export function PillLink({
  href,
  variant,
  size,
  className,
  children,
  ...props
}: React.PropsWithChildren<
  {
    href: string;
    variant?: PillVariant;
    size?: PillSize;
    className?: string;
  } & Omit<React.ComponentProps<typeof Link>, 'href' | 'className'>
>) {
  return (
    <Link
      href={href}
      className={pillButtonClasses({ variant, size, className })}
      {...props}
    >
      {children}
    </Link>
  );
}

/**
 * Une bande de page : filet en haut sur toute la largeur, colonne centrale
 * bordée de filets, petits points aux deux coins du haut.
 */
export function Band({
  children,
  className,
  innerClassName,
  topRule = true,
  ...props
}: React.PropsWithChildren<{
  className?: string;
  innerClassName?: string;
  topRule?: boolean;
}> &
  React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'relative px-4 sm:px-6',
        topRule && 'border-hairline border-t',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'border-hairline relative mx-auto w-full max-w-[62rem] sm:border-x',
          topRule &&
            'sm:before:bg-foreground/70 sm:after:bg-foreground/70 sm:before:absolute sm:before:-top-[2px] sm:before:-left-[2px] sm:before:size-[3px] sm:before:rounded-full sm:before:content-[""] sm:after:absolute sm:after:-top-[2px] sm:after:-right-[2px] sm:after:size-[3px] sm:after:rounded-full sm:after:content-[""]',
          innerClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Contenu d'une bande : l'air généreux d'ElevenLabs. */
export function BandBody({
  children,
  className,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('px-0 py-16 sm:px-7 md:py-24', className)}>
      {children}
    </div>
  );
}

export function Eyebrow({
  children,
  className,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <p
      className={cn(
        'text-base tracking-[0.01em] text-stone-700 dark:text-stone-300',
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Titre fin, grand et serré : la signature de la DA. */
export function DisplayTitle({
  as: Tag = 'h2',
  size = 'section',
  className,
  children,
}: React.PropsWithChildren<{
  as?: 'h1' | 'h2' | 'h3';
  size?: 'page' | 'section' | 'small';
  className?: string;
}>) {
  return (
    <Tag
      className={cn(
        'font-heading text-foreground font-light tracking-[-0.02em] text-pretty',
        {
          'text-[2.25rem] leading-[1.08] md:text-5xl md:leading-[1.08]':
            size === 'page',
          'text-[2rem] leading-[1.15] md:text-[2.25rem] md:leading-[1.17]':
            size === 'section',
          'text-[1.75rem] leading-[1.2]': size === 'small',
        },
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * En-tête de section : sur-titre, titre à gauche, phrase d'intro à droite,
 * boutons sous le titre.
 */
export function SectionIntro({
  eyebrow,
  title,
  intro,
  actions,
  titleAs = 'h2',
  size = 'section',
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  intro?: React.ReactNode;
  actions?: React.ReactNode;
  titleAs?: 'h1' | 'h2';
  size?: 'page' | 'section';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-x-12 gap-y-6 md:grid-cols-2 md:items-end',
        className,
      )}
    >
      <div className={'flex min-w-0 flex-col gap-y-3'}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <DisplayTitle as={titleAs} size={size}>
          {title}
        </DisplayTitle>
        {actions ? (
          <div className={'mt-3 flex flex-wrap items-center gap-2'}>
            {actions}
          </div>
        ) : null}
      </div>

      {intro ? (
        <div
          className={cn(
            'min-w-0 text-base leading-[1.5] tracking-[0.01em] md:text-[1.0625rem]',
            actions ? 'md:pb-[3.75rem]' : '',
          )}
        >
          {intro}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Carte grise façon ElevenLabs : pas de bordure, pas d'ombre, le texte posé
 * en bas (libellé gris puis phrase noire). `visual` occupe le haut.
 */
export function GrayCard({
  label,
  description,
  visual,
  icon,
  className,
  tone = 'gray',
}: {
  label: React.ReactNode;
  description: React.ReactNode;
  visual?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  tone?: 'gray' | 'image';
}) {
  return (
    <div
      className={cn(
        'relative flex min-h-[13.5rem] min-w-0 flex-col overflow-hidden rounded-2xl p-4',
        tone === 'gray' ? 'bg-muted' : 'bg-stone-900 text-white',
        className,
      )}
    >
      {icon ? (
        <span
          className={
            'bg-card ring-pill-ring shadow-soft text-foreground flex size-8 items-center justify-center rounded-lg ring-[0.5px] [&_svg]:size-4'
          }
        >
          {icon}
        </span>
      ) : null}

      {visual ? (
        <div
          className={'relative flex flex-1 items-center justify-center py-6'}
        >
          {visual}
        </div>
      ) : (
        <div className={'flex-1'} />
      )}

      <div className={'relative flex flex-col gap-y-1.5 pt-6'}>
        <span
          className={cn(
            'text-[0.9375rem] leading-[1.45] tracking-[0.01em]',
            tone === 'gray' ? 'text-muted-foreground' : 'text-white/70',
          )}
        >
          {label}
        </span>
        <span
          className={
            'text-[0.9375rem] leading-[1.45] tracking-[0.01em] text-pretty'
          }
        >
          {description}
        </span>
      </div>
    </div>
  );
}
