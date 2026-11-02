import { getTranslations } from 'next-intl/server';

import { PricingTable } from '@kit/billing-gateway/marketing';

import {
  Band,
  BandBody,
  DisplayTitle,
  PillLink,
} from '~/(marketing)/_components/el';
import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import billingConfig from '~/config/billing.config';
import pathsConfig from '~/config/paths.config';

export const generateMetadata = async () => {
  const t = await getTranslations('marketing');

  return {
    title: t('pricing'),
  };
};

const paths = {
  signUp: pathsConfig.auth.signUp,
  return: pathsConfig.app.home,
};

async function PricingPage() {
  const t = await getTranslations('marketing');
  const tCommon = await getTranslations('common');

  // Comment les crédits fonctionnent : 1 crédit par prospect en général, 2 à 4 pour les
  // campagnes difficiles (roadmap n°13), aucun plafond par jour, prix en dollars.
  const notes = [1, 2, 3, 4].map((n) => ({
    label: t(`home.pricingNote${n}Label`),
    text: t(`home.pricingNote${n}`),
  }));

  return (
    <div className={'flex flex-col'}>
      <SitePageHeader title={t('pricing')} subtitle={t('pricingSubtitle')} />

      <Band>
        <div className={'py-10 sm:-mx-4 md:py-14'}>
          <PricingTable paths={paths} config={billingConfig} />
        </div>
      </Band>

      {/* Comment les crédits fonctionnent : titre à gauche, liste en pointillés à droite */}
      <Band>
        <BandBody>
          <section
            className={'grid gap-x-12 gap-y-8 md:grid-cols-[1fr_1.6fr]'}
            data-test={'pricing-notes'}
          >
            <DisplayTitle size={'section'}>
              {t('home.pricingNotesTitle')}
            </DisplayTitle>

            <dl className={'flex flex-col'}>
              {notes.map((note) => (
                <div
                  key={note.label}
                  className={
                    'flex flex-col gap-y-1.5 bg-[linear-gradient(to_right,var(--stone-300)_50%,transparent_0)] bg-[length:5px_1px] bg-bottom bg-repeat-x py-5 first:pt-0 last:bg-none dark:bg-[linear-gradient(to_right,var(--stone-700)_50%,transparent_0)]'
                  }
                >
                  <dt className={'text-[1.0625rem] tracking-[0.01em]'}>
                    {note.label}
                  </dt>
                  <dd
                    className={
                      'text-muted-foreground text-[0.9375rem] leading-[1.5] tracking-[0.01em]'
                    }
                  >
                    {note.text}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </BandBody>
      </Band>

      <Band>
        <div
          className={
            'flex flex-col gap-6 py-12 sm:px-7 md:flex-row md:items-center md:justify-between'
          }
        >
          <DisplayTitle size={'section'}>{t('home.ctaTitle')}</DisplayTitle>

          <div className={'flex flex-wrap gap-2'}>
            <PillLink href={'/contact'} variant={'secondary'} size={'lg'}>
              {tCommon('contactUs')}
            </PillLink>
            <PillLink href={pathsConfig.auth.signUp} size={'lg'}>
              {tCommon('getStarted')}
            </PillLink>
          </div>
        </div>
      </Band>
    </div>
  );
}

export default PricingPage;
