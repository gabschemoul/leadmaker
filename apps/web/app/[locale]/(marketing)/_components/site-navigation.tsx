import { Suspense } from 'react';

import { NavigationMenu, NavigationMenuList } from '@kit/ui/navigation-menu';
import { Trans } from '@kit/ui/trans';

import { MobileSiteNavigation } from './mobile-site-navigation';
import { SiteNavigationItem, SiteNavigationLink } from './site-navigation-item';

const links = {
  HowItWorks: {
    label: 'marketing.navHow',
    path: '/#fonctionnement',
  },
  Pricing: {
    label: 'marketing.pricing',
    path: '/pricing',
  },
  Demo: {
    label: 'marketing.navDemo',
    path: '/#demo',
  },
  FAQ: {
    label: 'marketing.faq',
    path: '/faq',
  },
  SignIn: {
    label: 'auth.signIn',
    path: '/auth/sign-in',
    showOn: 'mobile',
    variant: 'outline' as const,
  },
  SignUp: {
    label: 'auth.signUp',
    path: '/auth/sign-up',
    showOn: 'mobile',
    variant: 'default' as const,
  },
};

const desktopLinks = Object.values(links).filter(
  (item) => !('showOn' in item && item.showOn === 'mobile'),
);

export function SiteNavigation() {
  return (
    <>
      <div className={'hidden items-center md:flex'}>
        <NavigationMenu>
          <NavigationMenuList className={'gap-x-0.5'}>
            {/* The fallback renders the same links without the active
                highlight, so the header never shifts. */}
            <Suspense
              fallback={desktopLinks.map((item) => (
                <SiteNavigationLink key={item.path} path={item.path}>
                  <Trans i18nKey={item.label} />
                </SiteNavigationLink>
              ))}
            >
              {desktopLinks.map((item) => (
                <SiteNavigationItem key={item.path} path={item.path}>
                  <Trans i18nKey={item.label} />
                </SiteNavigationItem>
              ))}
            </Suspense>
          </NavigationMenuList>
        </NavigationMenu>
      </div>

      <div className={'flex justify-start sm:items-center md:hidden'}>
        <MobileSiteNavigation links={Object.values(links)} />
      </div>
    </>
  );
}
