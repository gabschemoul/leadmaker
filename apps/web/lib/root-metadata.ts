import { Metadata } from 'next';

import appConfig from '~/config/app.config';

/**
 * @name generateRootMetadata
 * @description Generates the root metadata for the application
 */
export const generateRootMetadata = (): Metadata => {
  return {
    title: appConfig.title,
    description: appConfig.description,
    metadataBase: new URL(appConfig.url),
    applicationName: appConfig.name,
    openGraph: {
      url: appConfig.url,
      siteName: appConfig.name,
      title: appConfig.title,
      description: appConfig.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: appConfig.title,
      description: appConfig.description,
    },
    // Logo « i baguette » (10/11/2026) : icônes = l'étoile bleue seule sur carré
    // (62 % de la largeur). L'icône SVG, mise en premier pour que les navigateurs
    // la préfèrent, passe d'un carré noir (étoile blanche) à un carré blanc (étoile bleue) quand l'ordinateur est
    // en mode sombre ; les PNG/ICO (Safari, anciens navigateurs) restent noirs.
    // « ?v=3 » force les navigateurs à oublier l'ancienne icône.
    // Anciennes icônes : public/images/favicon-archive-repere/.
    icons: {
      icon: [
        { url: '/images/favicon/favicon.svg?v=3', type: 'image/svg+xml' },
        { url: '/images/favicon/favicon.ico?v=3', sizes: '48x48' },
      ],
      apple: '/images/favicon/apple-touch-icon.png',
    },
    manifest: '/images/favicon/site.webmanifest',
  };
};
