import { getTranslations } from 'next-intl/server';

import { PricingTable } from '@kit/billing-gateway/marketing';

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

  // Comment les crédits fonctionnent : 1 crédit par prospect en général, 2 à 4 pour les
  // campagnes difficiles (roadmap n°13), aucun plafond par jour, prix en dollars.
  const notes = [1, 2, 3, 4].map((n) => ({
    label: t(`home.pricingNote${n}Label`),
    text: t(`home.pricingNote${n}`),
  }));

  return (
    <div className={'flex flex-col space-y-8'}>
      <SitePageHeader title={t('pricing')} subtitle={t('pricingSubtitle')} />

      <div className={'container mx-auto pb-8 xl:pb-16'}>
        <PricingTable paths={paths} config={billingConfig} />

        <section
          className={'mx-auto mt-12 flex w-full max-w-4xl flex-col gap-y-6'}
          data-test={'pricing-notes'}
        >
          <h2 className={'font-heading text-2xl font-semibold tracking-tight'}>
            {t('home.pricingNotesTitle')}
          </h2>

          <dl className={'grid gap-6 sm:grid-cols-2'}>
            {notes.map((note) => (
              <div
                key={note.label}
                className={
                  'bg-muted/40 flex flex-col gap-y-2 rounded-lg border p-5'
                }
              >
                <dt className={'font-medium'}>{note.label}</dt>
                <dd className={'text-muted-foreground text-sm leading-relaxed'}>
                  {note.text}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

export default PricingPage;
