import {
  Geist_Mono as MonoFont,
  Host_Grotesk as HeadingFont,
  Inter as SansFont,
} from 'next/font/google';

import { cn } from '@kit/ui/utils';

/**
 * @sans
 * @description Texte : Inter (comme ElevenLabs).
 */
const sans = SansFont({
  subsets: ['latin'],
  variable: '--font-sans-fallback',
  fallback: ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial'],
  preload: true,
});

/**
 * @heading
 * @description Titres : Host Grotesk, remplaçant gratuit de Waldenburg
 * (ElevenLabs). Les grands titres marketing sont en 300 (fin).
 */
const heading = HeadingFont({
  subsets: ['latin'],
  variable: '--font-heading-face',
  fallback: ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial'],
  preload: true,
  weight: ['300', '400', '500', '600', '700'],
});

/** Code et chiffres techniques. */
const mono = MonoFont({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  fallback: ['ui-monospace', 'Menlo', 'monospace'],
  preload: false,
});

// we export these fonts into the root layout
export { sans, heading, mono };

/**
 * @name getFontsClassName
 * @description Get the class name for the root layout.
 *
 * Fonts only. The `dark`/`light` class is owned by next-themes, which sets it
 * before paint from the client — reading it on the server would need `cookies()`
 * in the root layout, which prevents every route from having a static shell.
 */
export function getFontsClassName() {
  const font = [sans.variable, heading.variable, mono.variable].reduce<
    string[]
  >((acc, curr) => {
    if (acc.includes(curr)) return acc;

    return [...acc, curr];
  }, []);

  return cn(...font);
}
