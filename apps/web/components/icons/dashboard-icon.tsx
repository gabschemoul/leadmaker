import type { SVGProps } from 'react';

/**
 * Icône « Tableau de bord » (maison arrondie, fournie par Gabriel le 10/11/2026). Même gabarit que les
 * autres icônes de la barre latérale : 18 px, trait 1,5 px, couleur du texte.
 */
export function DashboardIcon({
  strokeWidth = 1.5,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M5.81299 12.188H12.188M2.81299 7.70599C2.81299 7.07899 2.81299 6.76599 2.89099 6.47599C2.96099 6.21899 3.07599 5.97599 3.23099 5.75999C3.40499 5.51499 3.64799 5.31699 4.13299 4.91999L6.71999 2.80299C7.53199 2.13799 7.93899 1.80599 8.38999 1.67899C8.7889 1.56664 9.21108 1.56664 9.60999 1.67899C10.061 1.80599 10.467 2.13899 11.28 2.80299L13.867 4.91999C14.352 5.31699 14.595 5.51499 14.769 5.75999C14.924 5.97699 15.039 6.21899 15.109 6.47599C15.188 6.76599 15.188 7.07899 15.188 7.70599V11.588C15.188 12.848 15.188 13.478 14.942 13.959C14.7263 14.3822 14.3822 14.7263 13.959 14.942C13.478 15.188 12.848 15.188 11.588 15.188H6.41299C5.15299 15.188 4.52299 15.188 4.04099 14.942C3.61777 14.7263 3.27368 14.3822 3.05799 13.959C2.81299 13.478 2.81299 12.848 2.81299 11.588V7.70599Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
