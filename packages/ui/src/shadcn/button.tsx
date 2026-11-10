import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

import { Spinner } from './spinner';

/**
 * Boutons de l'appli calqués sur ElevenLabs (relevés au pixel le 10/11/2026 sur elevenlabs.io/app) :
 * - `outline` = bouton « Feedback » : 32 px, 13 px medium, arrondi 9,6 px, fond blanc, filet à 10 % ;
 *   survol : fond teinté à 2 %, filet à 16 % ; appui : 4,3 %.
 * - `default` = bouton « Create Voice » : noir, survol gris foncé, appui un cran plus clair.
 * - taille `lg` (et `buttonExtras.pill`) = gabarit « Create Voice » : 36 px, 14 px, arrondi 10 px, icône 18 px.
 * - `chip` = pastilles « Conversational / Narration » : 40 px, arrondi 12 px, fond transparent.
 * Transitions de couleur seulement, 75 ms, sans effet d'écrasement au clic.
 */
const buttonVariants = cva(
  "group/button focus-visible:ring-foreground/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 relative inline-flex shrink-0 items-center justify-center rounded-[0.6rem] border border-transparent bg-clip-padding text-[13px] leading-5 font-medium whitespace-nowrap transition-colors duration-75 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover aria-expanded:bg-primary-hover active:bg-[color-mix(in_oklab,var(--primary)_64%,var(--background))] disabled:opacity-40',
        outline:
          'bg-card text-foreground border-foreground/10 hover:border-foreground/16 active:border-foreground/16 aria-expanded:border-foreground/16 hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_2%)] active:bg-[color-mix(in_oklab,var(--card),var(--foreground)_4.3%)] aria-expanded:bg-[color-mix(in_oklab,var(--card),var(--foreground)_2%)]',
        secondary:
          'bg-foreground/[0.043] text-foreground hover:bg-foreground/[0.08] active:bg-foreground/10 aria-expanded:bg-foreground/[0.08]',
        ghost:
          'text-foreground hover:bg-foreground/[0.043] active:bg-foreground/10 aria-expanded:bg-foreground/[0.043]',
        chip: 'text-foreground border-foreground/10 hover:bg-foreground/[0.043] active:bg-foreground/10 aria-expanded:bg-foreground/[0.043] aria-pressed:border-foreground aria-pressed:bg-foreground/[0.02] aria-pressed:ring-foreground aria-pressed:ring-[0.5px]',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 [&>svg:first-child:not(:only-child)]:-ml-1 [&>svg:last-child:not(:only-child)]:-mr-1',
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-lg px-2 text-[13px] [&_svg:not([class*='size-'])]:size-3.5 [&>svg:first-child:not(:only-child)]:-ml-0.5",
        lg: "h-9 gap-1.5 rounded-[10px] px-3 text-[14px] [&_svg:not([class*='size-'])]:size-[18px] [&>svg:first-child:not(:only-child)]:-ml-[3px] [&>svg:last-child:not(:only-child)]:-mr-[3px]",
        chip: "h-10 gap-2 rounded-xl px-3 text-[14px] [&_svg:not([class*='size-'])]:size-[18px]",
        icon: 'size-8',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7 rounded-lg',
        'icon-lg':
          "size-9 rounded-[10px] [&_svg:not([class*='size-'])]:size-[18px]",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/**
 * `loading` (Prospectigo, 5/11/2026) : l'action est en cours — le bouton se désactive, ses icônes sont
 * remplacées par une roue qui tourne, devant le texte, et `aria-busy` est posé.
 * Utilisation : `<Button loading={action.isPending}>…</Button>` sur tout bouton qui lance une action serveur.
 */
function Button({
  className,
  variant = 'default',
  size = 'default',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        buttonVariants({ variant, size, className }),
        // pendant le chargement : la roue remplace les icônes du bouton
        loading &&
          'disabled:opacity-70 [&>svg:not([data-slot=spinner])]:hidden',
      )}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
