import { AppLogo } from '~/components/app-logo';

import { SiteHeaderAccountSection } from './site-header-account-section';
import { SiteNavigation } from './site-navigation';

/**
 * En-tête du site, façon ElevenLabs : logo, liens au centre-gauche, boutons
 * en pilule à droite. Collant, fond légèrement translucide et filet fin.
 */
export function SiteHeader() {
  return (
    <header
      className={
        'site-header bg-background/90 border-hairline sticky top-0 z-20 w-full border-b px-4 backdrop-blur-lg sm:px-6'
      }
    >
      {/* Comme ElevenLabs sur téléphone : logo à gauche, puis le bouton
          « S'inscrire » et le menu à droite. Sur ordinateur : logo, liens,
          boutons. */}
      <div
        className={
          'mx-auto flex h-16 w-full max-w-[62rem] items-center gap-x-3 md:gap-x-8'
        }
      >
        <AppLogo href="/" />

        <div className={'order-last md:order-none md:flex-1'}>
          <SiteNavigation />
        </div>

        <div
          className={'ml-auto flex items-center justify-end gap-x-2 md:ml-0'}
        >
          <SiteHeaderAccountSection />
        </div>
      </div>
    </header>
  );
}
