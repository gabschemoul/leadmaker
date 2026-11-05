import { getTranslations } from 'next-intl/server';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';

export async function generateMetadata() {
  const t = await getTranslations('marketing');

  return {
    title: t('cookiePolicy'),
  };
}

async function CookiePolicyPage() {
  const t = await getTranslations('marketing');

  return (
    <div>
      <SitePageHeader
        title={t(`cookiePolicy`)}
        subtitle={t(`cookiePolicyDescription`)}
      />

      <div className={'container mx-auto py-8'}>
        <div>Your terms of service content here</div>
      </div>
    </div>
  );
}

export default CookiePolicyPage;
