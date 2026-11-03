import { AppLogo } from '~/components/app-logo';

import { SiteHeaderAccountSection } from './site-header-account-section';
import { SiteNavigation } from './site-navigation';

/**
 * En-tête du site : logo, liens, boutons en pilule à droite. Collant, fond
 * légèrement translucide et filet fin. Aussi large que la page d'accueil
 * (marges de 16 à 88 px, comme Apollo).
 */
export function SiteHeader() {
  return (
    <header
      className={
        'site-header bg-background/90 border-hairline sticky top-0 z-20 w-full border-b px-[clamp(16px,5.4vw,88px)] backdrop-blur-lg'
      }
    >
      {/* Comme ElevenLabs sur téléphone : logo à gauche, puis le bouton
          « S'inscrire » et le menu à droite. Sur ordinateur : logo, liens,
          boutons. */}
      <div
        className={
          'mx-auto flex h-16 w-full max-w-[1880px] items-center gap-x-3 md:h-[72px] md:gap-x-9'
        }
      >
        <AppLogo href="/" linkClassName={'shrink-0'} />

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
