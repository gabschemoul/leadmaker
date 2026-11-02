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
    // Logo « Le repère » (2/11/2026) : icônes générées depuis le symbole de
    // components/app-logo.tsx.
    icons: {
      icon: [
        { url: '/images/favicon/favicon.ico', sizes: '48x48' },
        { url: '/images/favicon/favicon.svg', type: 'image/svg+xml' },
      ],
      apple: '/images/favicon/apple-touch-icon.png',
    },
    manifest: '/images/favicon/site.webmanifest',
  };
};
