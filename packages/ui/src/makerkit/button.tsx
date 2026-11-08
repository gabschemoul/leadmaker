// Prospectigo (8/11/2026) — variantes de bouton propres au projet, appliquées par `className`
// pour laisser `shadcn/button.tsx` intact, p. ex. :
//   <Button className={buttonExtras.brand}>Nouvelle campagne</Button>
// `cn()` fait gagner ces classes sur `bg-primary` / `hover:bg-primary-hover` de la variante par défaut.

export const buttonExtras = {
  /** L'action principale de la page, en bleu Klein (une seule par écran). */
  brand: 'bg-brand text-brand-foreground hover:bg-brand-hover',
  /** Grand appel à l'action en pilule (connexion, paiement, lancer la campagne). */
  pill: 'h-9 rounded-full px-4 text-sm',
} as const;

export type ButtonExtraVariant = keyof typeof buttonExtras;
