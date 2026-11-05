import { getTranslations } from 'next-intl/server';

import { LegalPage } from '../_components/legal-page';

export async function generateMetadata() {
  const t = await getTranslations('marketing');

  return {
    title: t('privacyPolicy'),
  };
}

function PrivacyPolicyPage() {
  return (
    <LegalPage
      id={'privacy'}
      titleKey={'privacyPolicy'}
      subtitleKey={'privacyPolicyDescription'}
    />
  );
}

export default PrivacyPolicyPage;
