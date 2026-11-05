import { MetadataRoute } from 'next';

import appConfig from '~/config/app.config';

/** Les moteurs de recherche n'indexent que le site public (pas l'appli, l'admin ni les brouillons). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/home',
        '/admin',
        '/auth',
        '/join',
        '/identities',
        '/update-password',
        '/archives',
        '/api',
      ],
    },
    sitemap: `${appConfig.url}/sitemap.xml`,
  };
}
