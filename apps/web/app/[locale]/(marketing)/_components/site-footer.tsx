import { cacheLife } from 'next/cache';
import Link from 'next/link';

import { Trans } from '@kit/ui/trans';

import { AppLogo } from '~/components/app-logo';
import appConfig from '~/config/app.config';

import { Band } from './el';

/**
 * `new Date()` can't be prerendered — it changes every render. Caching it makes
 * the value stable for the prerender and refreshes it daily.
 */
async function getCopyrightYear() {
  'use cache';
  cacheLife('days');

  return new Date().getFullYear();
}

const sections = [
  {
    heading: 'marketing.product',
    links: [
      { href: '/pricing', label: 'marketing.pricing' },
      { href: '/faq', label: 'marketing.faq' },
      { href: '/auth/sign-up', label: 'auth.signUp' },
      { href: '/auth/sign-in', label: 'auth.signIn' },
    ],
  },
  {
    heading: 'marketing.about',
    links: [{ href: '/contact', label: 'marketing.contact' }],
  },
  {
    heading: 'marketing.legal',
    links: [
      { href: '/terms-of-service', label: 'marketing.termsOfService' },
      { href: '/privacy-policy', label: 'marketing.privacyPolicy' },
      { href: '/cookie-policy', label: 'marketing.cookiePolicy' },
    ],
  },
];

/** Pied de page façon ElevenLabs : logo à gauche, colonnes de liens à titres gris. */
export async function SiteFooter() {
  const year = await getCopyrightYear();

  return (
    <footer className={'site-footer mt-auto w-full'}>
      <Band>
        <div
          className={
            'grid gap-12 py-16 sm:px-7 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:py-20'
          }
        >
          <div className={'flex flex-col gap-y-4'}>
            <AppLogo />
            <p
              className={
                'text-muted-foreground max-w-[16rem] text-sm leading-[1.45]'
              }
            >
              <Trans i18nKey="marketing.footerDescription" />
            </p>
          </div>

          {sections.map((section) => (
            <div key={section.heading} className={'flex flex-col gap-y-3'}>
              <p className={'text-muted-foreground text-sm'}>
                <Trans i18nKey={section.heading} />
              </p>

              <ul className={'flex flex-col gap-y-2'}>
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={
                        'text-foreground hover:text-muted-foreground text-[0.9375rem] tracking-[0.01em] transition-colors'
                      }
                    >
                      <Trans i18nKey={link.label} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Band>

      <Band>
        <div
          className={
            'text-muted-foreground flex flex-col gap-2 py-6 text-[0.8125rem] sm:flex-row sm:items-center sm:justify-between sm:px-7'
          }
        >
          <span>
            <Trans
              i18nKey="marketing.copyright"
              values={{
                product: appConfig.name,
                year,
              }}
            />
          </span>
        </div>
      </Band>
    </footer>
  );
}
