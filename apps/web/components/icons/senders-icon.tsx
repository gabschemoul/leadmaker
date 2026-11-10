import type { SVGProps } from 'react';

/** Icône « Expéditeurs » (personne qui parle, fournie par Gabriel le 10/11/2026), gabarit 18 × 18, trait 1,5. */
export function SendersIcon({
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
      <g stroke="currentColor" strokeWidth={strokeWidth}>
        <path
          d="M9.29324 5.29431C9.29324 6.727 8.15462 7.88843 6.75003 7.88843C5.34543 7.88843 4.20679 6.727 4.20679 5.29431C4.20679 3.86162 5.34543 2.7002 6.75003 2.7002C8.15462 2.7002 9.29324 3.86162 9.29324 5.29431Z"
          strokeLinejoin="round"
        />
        <path
          d="M6.75005 10.1118C4.58578 10.1118 2.88021 11.2635 1.97847 12.9743C1.37019 14.1283 2.41019 15.3 3.69472 15.3H9.80537C11.0899 15.3 12.1299 14.1283 11.5217 12.9743C10.6199 11.2635 8.91431 10.1118 6.75005 10.1118Z"
          strokeLinejoin="round"
        />
        <path
          d="M14.0569 4.5C15.8143 6.25736 15.8143 9.10656 14.0569 10.864M11.9355 6.62132C12.5214 7.20711 12.5214 8.15685 11.9355 8.74265"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
