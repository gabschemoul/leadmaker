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
      <div className={'relative isolate container mx-auto'}>
        <HeroBackdrop />

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
            <span className="text-foreground">
              {t.rich('title', {
                hl: (chunks) => <span className="text-primary">{chunks}</span>,
              })}
            </span>
          }
          subtitle={<span>{t('subtitle')}</span>}
          cta={<MainCallToActionButton />}
          image={
            <>
              <Image
                priority
                className={'w-full rounded-lg border shadow-xl dark:hidden'}
                width={2880}
                height={1800}
                src={`/images/prospectigo-campaign-v2.png`}
                alt={t('heroImageAlt')}
              />
              <Image
                className={
                  'hidden w-full rounded-lg border shadow-xl dark:block'
                }
                width={2880}
                height={1800}
                src={`/images/prospectigo-campaign-dark-v2.png`}
                alt={t('heroImageAlt')}
              />
            </>
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
            className="rounded-md border dark:hidden"
            src={'/images/prospectigo-forms-v2.png'}
            alt={t('controlImageAlt')}
            width={2880}
            height={1150}
          />
          <Image
            className="hidden rounded-md border dark:block"
            src={'/images/prospectigo-forms-dark-v2.png'}
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

/**
 * Fond du haut de page : courbes de niveau d'une carte et une épingle (thème
 * clair « Atlas »), halo ambre en thème sombre (« Nocturne »). Décoratif.
 */
function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className={
        'pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[620px] overflow-hidden'
      }
    >
      <svg
        className={'text-primary absolute inset-0 h-full w-full dark:hidden'}
        viewBox={'0 0 1200 620'}
        preserveAspectRatio={'xMidYMid slice'}
      >
        <g fill={'none'} stroke={'currentColor'} strokeOpacity={0.09}>
          <g transform={'translate(115 -70)'}>
            <path d="M930 70c150 0 270 95 270 225s-120 240-270 240-235-95-235-225 85-240 235-240z" />
            <path d="M935 130c110 0 195 68 195 162s-85 172-195 172-170-68-170-160 60-174 170-174z" />
            <path d="M940 190c70 0 122 44 122 102s-52 110-122 110-108-44-108-100 38-112 108-112z" />
            <path d="M945 245c35 0 60 22 60 50s-25 54-60 54-52-22-52-50 18-54 52-54z" />
          </g>
          <path d="M260 40c120 0 210 70 210 160s-90 170-210 170S70 300 70 210 140 40 260 40z" />
          <path d="M262 100c80 0 140 46 140 108s-60 112-140 112-128-46-128-106 48-114 128-114z" />
          <path d="M-40 560c200-70 360-20 560 25s420 40 720-40" />
          <path d="M-40 610c200-70 360-20 560 25s420 40 720-40" />
        </g>
        <g transform={'translate(1060 222)'} className={'text-brand'}>
          <path
            d="M0-30c-13 0-23 10-23 23 0 17 23 40 23 40s23-23 23-40c0-13-10-23-23-23z"
            fill={'currentColor'}
            opacity={0.9}
          />
          <circle cy={-7} r={8} className={'fill-primary'} />
        </g>
      </svg>

      <div
        className={'absolute inset-0 hidden dark:block'}
        style={{
          background:
            'radial-gradient(45% 55% at 78% 30%, color-mix(in srgb, var(--brand) 22%, transparent), transparent 70%)',
        }}
      />
    </div>
  );
}

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
