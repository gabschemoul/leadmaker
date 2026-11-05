import withBundleAnalyzer from '@next/bundle-analyzer';
import createNextIntlPlugin from 'next-intl/plugin';

// Create next-intl plugin with the request config path
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ENABLE_REACT_COMPILER = process.env.ENABLE_REACT_COMPILER === 'true';

const INTERNAL_PACKAGES = [
  '@kit/ui',
  '@kit/auth',
  '@kit/accounts',
  '@kit/admin',
  '@kit/team-accounts',
  '@kit/shared',
  '@kit/supabase',
  '@kit/i18n',
  '@kit/mailers',
  '@kit/billing-gateway',
  '@kit/email-templates',
  '@kit/database-webhooks',
  '@kit/cms',
  '@kit/monitoring',
  '@kit/next',
  '@kit/notifications',
];

/** @type {import('next').NextConfig} */
const config = {
  // NEXT_DIST_DIR : un 2e serveur de dev en parallèle (ex. tests sur une base d'essai) ; jamais posé sur Vercel
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: INTERNAL_PACKAGES,
  images: getImagesConfig(),
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  serverExternalPackages: [],
  // needed for supporting dynamic imports for local content
  outputFileTracingIncludes: {
    '/*': ['./content/**/*'],
  },
  redirects: getRedirects,
  headers: getSecurityHeaders,
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    resolveAlias: getModulesAliases(),
  },
  devIndicators:
    process.env.NEXT_PUBLIC_CI === 'true'
      ? false
      : {
          position: 'bottom-right',
        },
  reactCompiler: ENABLE_REACT_COMPILER,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    globalNotFound: true,
    mdxRs: true,
    turbopackFileSystemCacheForDev: true,
    useTypeScriptCli: true,
    turbopackRustReactCompiler: ENABLE_REACT_COMPILER,
    turbopackGc: true,
    optimizePackageImports: [
      'recharts',
      'lucide-react',
      'date-fns',
      ...INTERNAL_PACKAGES,
    ],
  },
  modularizeImports: {
    lodash: {
      transform: 'lodash/{{member}}',
    },
  },
};

export default withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})(withNextIntl(config));

/** @returns {import('next').NextConfig['images']} */
function getImagesConfig() {
  const remotePatterns = [];

  if (SUPABASE_URL) {
    const hostname = new URL(SUPABASE_URL).hostname;

    remotePatterns.push({
      protocol: 'https',
      hostname,
    });
  }

  if (IS_PRODUCTION) {
    return {
      remotePatterns,
    };
  }

  remotePatterns.push(
    ...[
      {
        protocol: 'http',
        hostname: '127.0.0.1',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  );

  return {
    remotePatterns,
    // local Supabase Storage is served from 127.0.0.1, which Next.js 16
    // refuses to optimize by default (SSRF guard). Dev server only.
    dangerouslyAllowLocalIP: process.env.NODE_ENV === 'development',
  };
}

async function getRedirects() {
  return [
    {
      source: '/server-sitemap.xml',
      destination: '/sitemap.xml',
      permanent: true,
    },
  ];
}

/**
 * @description Aliases modules based on the environment variables
 * This will speed up the development server by not loading the modules that are not needed
 * @returns {Record<string, string>}
 */
function getModulesAliases() {
  if (process.env.NODE_ENV !== 'development') {
    return {};
  }

  const monitoringProvider = process.env.NEXT_PUBLIC_MONITORING_PROVIDER;
  const billingProvider = process.env.NEXT_PUBLIC_BILLING_PROVIDER;
  const mailerProvider = process.env.MAILER_PROVIDER;
  const captchaProvider = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY;

  // exclude the modules that are not needed
  const excludeSentry = monitoringProvider !== 'sentry';
  const excludeStripe = billingProvider !== 'stripe';
  const excludeNodemailer = mailerProvider !== 'nodemailer';
  const excludeTurnstile = !captchaProvider;

  /** @type {Record<string, string>} */
  const aliases = {};

  // the path to the noop module
  const noopPath = '~/lib/dev-mock-modules';

  if (excludeSentry) {
    aliases['@sentry/nextjs'] = noopPath;
  }

  if (excludeStripe) {
    aliases['stripe'] = noopPath;
    aliases['@stripe/stripe-js'] = noopPath;
  }

  if (excludeNodemailer) {
    aliases['nodemailer'] = noopPath;
  }

  if (excludeTurnstile) {
    aliases['@marsidev/react-turnstile'] = noopPath;
  }

  return aliases;
}

/**
 * En-têtes de sécurité sur toutes les pages (audit 5/11/2026, B5) : la page ne peut pas être affichée dans
 * un cadre d'un autre site (clic piégé sur « Lancer », « Valider »…), le navigateur ne devine pas les types
 * de fichiers, et l'adresse complète des pages n'est pas transmise aux autres sites.
 */
async function getSecurityHeaders() {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
        },
      ],
    },
  ];
}
