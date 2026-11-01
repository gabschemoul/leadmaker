import Image from 'next/image';
import Link from 'next/link';

import { ArrowRightIcon, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PricingTable } from '@kit/billing-gateway/marketing';
import {
  CtaButton,
  EcosystemShowcase,
  FeatureCard,
  FeatureGrid,
  FeatureShowcase,
  FeatureShowcaseIconContainer,
  Hero,
  Pill,
  PillActionButton,
  SecondaryHero,
} from '@kit/ui/marketing';
import { Trans } from '@kit/ui/trans';

import billingConfig from '~/config/billing.config';
import pathsConfig from '~/config/paths.config';

/** Page d'accueil Prospectigo (V1). Les textes vivent dans marketing.json. */
async function Home() {
  const t = await getTranslations('marketing.home');

  const steps = ['step1', 'step2', 'step3'] as const;
  const features = [
    'feature1',
    'feature2',
    'feature3',
    'feature4',
    'feature5',
    'feature6',
  ] as const;

  return (
    <div className={'mt-4 flex flex-col space-y-24 py-14'}>
      <div className={'container mx-auto'}>
        <Hero
          pill={
            <Pill label={t('pill')}>
              <span>{t('pillText')}</span>
              <PillActionButton
                render={
                  <Link href={'/auth/sign-up'}>
                    <ArrowRightIcon className={'h-4 w-4'} />
                  </Link>
                }
              />
            </Pill>
          }
          title={
            <span className="text-secondary-foreground">{t('title')}</span>
          }
          subtitle={<span>{t('subtitle')}</span>}
          cta={<MainCallToActionButton />}
          image={
            <Image
              priority
              className={
                'dark:border-primary/10 w-full rounded-lg border border-gray-200'
              }
              width={2880}
              height={1800}
              src={`/images/prospectigo-campaign.png`}
              alt={t('heroImageAlt')}
            />
          }
        />
      </div>

      <div className={'container mx-auto'}>
        <div
          className={
            'flex flex-col items-center justify-center space-y-12 py-4 xl:py-8'
          }
        >
          <SecondaryHero
            heading={t('howTitle')}
            subheading={t('howSubtitle')}
          />

          <FeatureGrid>
            {steps.map((step) => (
              <FeatureCard
                key={step}
                className={'relative col-span-1 overflow-hidden'}
                label={t(`${step}Label`)}
                description={t(step)}
              />
            ))}
          </FeatureGrid>
        </div>
      </div>

      <div className={'container mx-auto'}>
        <div className={'py-4 xl:py-8'}>
          <FeatureShowcase
            heading={
              <>
                <b className="font-medium tracking-tight dark:text-white">
                  {t('featuresTitle')}
                </b>
                .{' '}
                <span className="text-secondary-foreground/70 block font-normal tracking-tight">
                  {t('featuresSubtitle')}
                </span>
              </>
            }
            icon={
              <FeatureShowcaseIconContainer>
                <Sparkles className="h-4 w-4" />
                <span>{t('featuresIcon')}</span>
              </FeatureShowcaseIconContainer>
            }
          >
            <FeatureGrid>
              {features.map((feature) => (
                <FeatureCard
                  key={feature}
                  className={'relative col-span-1 overflow-hidden'}
                  label={t(`${feature}Label`)}
                  description={t(feature)}
                />
              ))}
            </FeatureGrid>
          </FeatureShowcase>
        </div>
      </div>

      <div className={'container mx-auto'}>
        <EcosystemShowcase
          heading={t('controlTitle')}
          description={t('controlText')}
        >
          <Image
            className="dark:border-primary/10 rounded-md border border-gray-200"
            src={'/images/prospectigo-forms.png'}
            alt={t('controlImageAlt')}
            width={2880}
            height={1150}
          />
        </EcosystemShowcase>
      </div>

      <div className={'container mx-auto'}>
        <div
          className={
            'flex flex-col items-center justify-center space-y-12 py-4 xl:py-8'
          }
        >
          <SecondaryHero
            pill={<Pill label={t('pricingPill')}>{t('pricingPillText')}</Pill>}
            heading={t('pricingTitle')}
            subheading={t('pricingSubtitle')}
          />

          <div className={'w-full'}>
            <PricingTable
              config={billingConfig}
              paths={{
                signUp: pathsConfig.auth.signUp,
                return: pathsConfig.app.home,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;

function MainCallToActionButton() {
  return (
    <div className={'flex space-x-2.5'}>
      <CtaButton className="h-10 text-sm">
        <Link href={'/auth/sign-up'}>
          <span className={'flex items-center space-x-0.5'}>
            <span>
              <Trans i18nKey={'common.getStarted'} />
            </span>

            <ArrowRightIcon
              className={
                'animate-in fade-in slide-in-from-left-8 h-4' +
                ' zoom-in fill-mode-both delay-1000 duration-1000'
              }
            />
          </span>
        </Link>
      </CtaButton>

      <CtaButton variant={'link'} className="h-10 text-sm">
        <Link href={'/pricing'}>
          <Trans i18nKey={'common.pricing'} />
        </Link>
      </CtaButton>
    </div>
  );
}
