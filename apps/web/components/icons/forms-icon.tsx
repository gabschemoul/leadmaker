import type { SVGProps } from 'react';

/**
 * Icône « Formulaires » (bulle avec étincelle, fournie par Gabriel le 10/11/2026), gabarit 18 × 18. Trait
 * ramené de 1,65 à 1,5 pour être identique aux autres icônes de la barre latérale.
 */
export function FormsIcon({
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
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        d="M9.563 2.813h-5.25a2.25 2.25 0 0 0-2.25 2.25v6.375a2.25 2.25 0 0 0 2.25 2.25h2.176a.75.75 0 0 1 .482.175l1.548 1.298a.75.75 0 0 0 .96.003l1.575-1.304a.75.75 0 0 1 .478-.172h2.156a2.25 2.25 0 0 0 2.25-2.25v-2.25"
      />
      <path
        fill="currentColor"
        d="m15.18 3.139-.522-1.359a.437.437 0 0 0-.816 0l-.522 1.359a.75.75 0 0 1-.431.43l-1.359.523a.437.437 0 0 0 0 .816l1.359.522a.75.75 0 0 1 .43.431l.523 1.359a.437.437 0 0 0 .816 0l.522-1.359a.75.75 0 0 1 .431-.43l1.359-.523a.437.437 0 0 0 0-.816l-1.359-.522a.75.75 0 0 1-.431-.431"
      />
    </svg>
  );
}
