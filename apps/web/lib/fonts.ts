import {
  Figtree as SansFont,
  Schibsted_Grotesk as HeadingFont,
} from 'next/font/google';

import { cn } from '@kit/ui/utils';

/**
 * @sans
 * @description Define here the sans font.
 * Prospectigo : Figtree pour le texte.
 */
const sans = SansFont({
  subsets: ['latin'],
  variable: '--font-sans-fallback',
  fallback: ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial'],
  preload: true,
  weight: ['300', '400', '500', '600', '700'],
});

/**
 * @heading
 * @description Prospectigo : Schibsted Grotesk pour les titres.
 */
const heading = HeadingFont({
  subsets: ['latin'],
  variable: '--font-heading-face',
  fallback: ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial'],
  preload: true,
  weight: ['500', '600', '700', '800'],
});

// we export these fonts into the root layout
export { sans, heading };

/**
 * @name getFontsClassName
 * @description Get the class name for the root layout.
 *
 * Fonts only. The `dark`/`light` class is owned by next-themes, which sets it
 * before paint from the client — reading it on the server would need `cookies()`
 * in the root layout, which prevents every route from having a static shell.
 */
export function getFontsClassName() {
  const font = [sans.variable, heading.variable].reduce<string[]>(
    (acc, curr) => {
      if (acc.includes(curr)) return acc;

      return [...acc, curr];
    },
    [],
  );

  return cn(...font);
}
