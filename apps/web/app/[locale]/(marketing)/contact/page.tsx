import { getTranslations } from 'next-intl/server';

import { Trans } from '@kit/ui/trans';

import { Band, BandBody, DisplayTitle } from '~/(marketing)/_components/el';
import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { ContactForm } from '~/(marketing)/contact/_components/contact-form';

export async function generateMetadata() {
  const t = await getTranslations('marketing');

  return {
    title: t('contact'),
  };
}

async function ContactPage() {
  const t = await getTranslations('marketing');

  return (
    <div className={'flex flex-col'}>
      <SitePageHeader title={t(`contact`)} subtitle={t(`contactDescription`)} />

      <Band>
        <BandBody>
          <div className={'grid gap-x-12 gap-y-8 md:grid-cols-[1fr_1.6fr]'}>
            <div className={'flex flex-col gap-y-2'}>
              <DisplayTitle size={'section'}>
                <Trans i18nKey={'marketing.contactHeading'} />
              </DisplayTitle>

              <p className={'text-muted-foreground tracking-[0.01em]'}>
                <Trans i18nKey={'marketing.contactSubheading'} />
              </p>
            </div>

            <div className={'bg-muted rounded-2xl p-5 sm:p-6'}>
              <ContactForm />
            </div>
          </div>
        </BandBody>
      </Band>
    </div>
  );
}

export default ContactPage;
