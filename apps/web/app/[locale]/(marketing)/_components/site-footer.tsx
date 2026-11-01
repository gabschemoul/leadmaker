import { cacheLife } from 'next/cache';

import { Footer } from '@kit/ui/marketing';
import { Trans } from '@kit/ui/trans';

import { AppLogo } from '~/components/app-logo';
import appConfig from '~/config/app.config';

/**
 * `new Date()` can't be prerendered — it changes every render. Caching it makes
 * the value stable for the prerender and refreshes it daily.
 */
async function getCopyrightYear() {
  'use cache';
  cacheLife('days');

  return new Date().getFullYear();
}

export async function SiteFooter() {
  const year = await getCopyrightYear();

  return (
    <Footer
      logo={<AppLogo className="w-[85px] md:w-[95px]" />}
      description={<Trans i18nKey="marketing.footerDescription" />}
      copyright={
        <Trans
          i18nKey="marketing.copyright"
          values={{
            product: appConfig.name,
            year,
          }}
        />
      }
      sections={[
        {
          heading: <Trans i18nKey="marketing.product" />,
          links: [
            { href: '/pricing', label: <Trans i18nKey="marketing.pricing" /> },
            { href: '/faq', label: <Trans i18nKey="marketing.faq" /> },
          ],
        },
        {
          heading: <Trans i18nKey="marketing.about" />,
          links: [
            { href: '/contact', label: <Trans i18nKey="marketing.contact" /> },
          ],
        },
        {
          heading: <Trans i18nKey="marketing.legal" />,
          links: [
            {
              href: '/terms-of-service',
              label: <Trans i18nKey="marketing.termsOfService" />,
            },
            {
              href: '/privacy-policy',
              label: <Trans i18nKey="marketing.privacyPolicy" />,
            },
            {
              href: '/cookie-policy',
              label: <Trans i18nKey="marketing.cookiePolicy" />,
            },
          ],
        },
      ]}
    />
  );
}
