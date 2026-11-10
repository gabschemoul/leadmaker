import type { SVGProps } from 'react';

/** Icône « Campagnes » (quatre cercles, fournie par Gabriel le 10/11/2026), gabarit 18 × 18, trait 1,5. */
export function CampaignsIcon({
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
        <circle cx="5.0625" cy="5.0625" r="2.8125" />
        <circle cx="5.0625" cy="12.9375" r="2.8125" />
        <circle cx="12.9375" cy="5.0625" r="2.8125" />
        <circle cx="12.9375" cy="12.9375" r="2.8125" />
      </g>
    </svg>
  );
}
