import '../../styles/globals.css';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { hasLocale } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { PublicEnvScript } from 'next-runtime-env';

import { routing } from '@kit/i18n/routing';
import { Toaster } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { NavigationProgress } from '~/components/navigation-progress';
import { RootProviders } from '~/components/root-providers';
import { getFontsClassName } from '~/lib/fonts';
import { generateRootMetadata } from '~/lib/root-metadata';

export const generateMetadata = () => {
  return generateRootMetadata();
};

/**
 * Cache Components requires every root parameter to have at least one value,
 * or the build fails.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const [nonce, messages] = await Promise.all([
    getCspNonce(),
    getMessages({ locale }),
  ]);

  return (
    <html lang={locale} className={getRootClassName()} suppressHydrationWarning>
      <head>
        <PublicEnvScript nonce={nonce} />
      </head>

      <body>
        <RootProviders locale={locale} nonce={nonce} messages={messages}>
          {children}

          <Toaster richColors={true} position="top-center" />

          {/* barre de chargement en haut de l'écran pendant un changement de page */}
          <NavigationProgress />
        </RootProviders>
      </body>
    </html>
  );
}

function getRootClassName() {
  return cn(
    'bg-background min-h-screen antialiased md:overscroll-y-none',
    getFontsClassName(),
  );
}

/**
 * Reading `headers()` here makes every route dynamic, so it is gated on the
 * flag that produces the nonce in the first place. A CSP nonce must be unique
 * per response and can never live in a cached static shell — enabling
 * `ENABLE_STRICT_CSP` therefore also requires `export const instant = false`
 * on this layout, and removing `ensureStatic` from the marketing layout.
 */
async function getCspNonce() {
  if (process.env.ENABLE_STRICT_CSP !== 'true') {
    return undefined;
  }

  const headersStore = await headers();

  return headersStore.get('x-nonce') ?? undefined;
}
