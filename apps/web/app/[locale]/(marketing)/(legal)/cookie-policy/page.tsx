import { getTranslations } from 'next-intl/server';

import { LegalPage } from '../_components/legal-page';

export async function generateMetadata() {
  const t = await getTranslations('marketing');

  return {
    title: t('cookiePolicy'),
  };
}

function CookiePolicyPage() {
  return (
    <LegalPage
      id={'cookies'}
      titleKey={'cookiePolicy'}
      subtitleKey={'cookiePolicyDescription'}
    />
  );
}

export default CookiePolicyPage;
