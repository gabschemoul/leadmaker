import { getTranslations } from 'next-intl/server';

import { LegalPage } from '../_components/legal-page';

export async function generateMetadata() {
  const t = await getTranslations('marketing');

  return {
    title: t('termsOfService'),
  };
}

function TermsOfServicePage() {
  return (
    <LegalPage
      id={'terms'}
      titleKey={'termsOfService'}
      subtitleKey={'termsOfServiceDescription'}
    />
  );
}

export default TermsOfServicePage;
