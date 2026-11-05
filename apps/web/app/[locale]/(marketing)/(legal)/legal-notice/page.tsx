import { getTranslations } from 'next-intl/server';

import { LegalPage } from '../_components/legal-page';

export async function generateMetadata() {
  const t = await getTranslations('marketing');

  return {
    title: t('legalNotice'),
  };
}

function LegalNoticePage() {
  return (
    <LegalPage
      id={'notice'}
      titleKey={'legalNotice'}
      subtitleKey={'legalNoticeDescription'}
    />
  );
}

export default LegalNoticePage;
