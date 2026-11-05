import { MetadataRoute } from 'next';

import appConfig from '~/config/app.config';

/**
 * Pages publiques indexables du site Prospectigo. Les pages de démo du kit de départ (blog, documentation,
 * journal des versions) ont été retirées le 5/11/2026 ; ajoutez ici toute nouvelle page publique.
 */
const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/faq',
  '/contact',
  '/terms-of-service',
  '/privacy-policy',
  '/cookie-policy',
  '/legal-notice',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date().toISOString();

  return PUBLIC_PATHS.map((path) => ({
    url: new URL(path, appConfig.url).href,
    lastModified,
    changeFrequency: 'weekly',
    priority: path === '/' ? 1 : 0.8,
  }));
}
