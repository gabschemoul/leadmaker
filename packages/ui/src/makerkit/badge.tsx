// Project-specific Badge variants. Apply via `className` so that
// `shadcn/badge.tsx` stays upstream-equivalent and CLI-replaceable, e.g.:
//   <Badge className={badgeExtras.success}>OK</Badge>

export const badgeExtras = {
  info: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
  success:
    'bg-green-600/10 text-green-700 dark:bg-green-600/20 dark:text-green-400 [&>svg]:text-green-600',
  warning:
    'bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 [&>svg]:text-amber-600',
  /* Prospectigo (8/11/2026) : « en cours » en bleu Klein pâle, cohérent avec l'étape active */
  brand: 'bg-brand-pale text-brand dark:text-brand [&>svg]:text-brand',
  /* point coloré devant le texte (statut dans un tableau) */
  dot: 'before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-[""]',
} as const;

export type BadgeExtraVariant = keyof typeof badgeExtras;
