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
      <div
        className={
          'relative mx-auto flex h-16 w-full max-w-[62rem] items-center gap-x-8'
        }
      >
        {/* Sur téléphone, le logo est centré sur la largeur de l'écran,
            quelle que soit la largeur du menu et des boutons de chaque côté. */}
        <div
          className={
            'absolute left-1/2 -translate-x-1/2 md:static md:translate-x-0'
          }
        >
          <AppLogo href="/" />
        </div>

        <div className={'order-first md:order-none md:flex-1'}>
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
