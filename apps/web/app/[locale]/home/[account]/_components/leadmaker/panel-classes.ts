/**
 * Rôle : classes des sélecteurs du panneau « Réglages » (pilote automatique), relevées le 10/11/2026 sur le panneau
 * de « Text to Speech » d'ElevenLabs : 40 px, arrondi 10 px, fond blanc, filet 10 % (16 % au survol), 14 px medium.
 */

/** Bouton ou lien qui ouvre un choix (flèche › à droite). */
export const panelSelectorClasses =
  'bg-card border-foreground/10 hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_2%)] hover:border-foreground/16 flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border px-3 text-left text-[14px] font-medium transition-colors duration-75 disabled:pointer-events-none disabled:opacity-50';

/** Liste déroulante (NativeSelect, sur son enveloppe). */
export const panelSelectClasses =
  'w-full [&_select]:bg-card [&_select]:border-foreground/10 [&_select]:hover:border-foreground/16 [&_select]:h-10 [&_select]:rounded-[10px] [&_select]:pl-3 [&_select]:text-[14px] [&_select]:font-medium';

/** Libellé d'une ligne du panneau et petit lien à sa droite. */
export const panelLabelClasses = 'text-sm font-medium';
export const panelLinkClasses =
  'text-muted-foreground hover:text-foreground text-[13px] font-medium transition-colors';
