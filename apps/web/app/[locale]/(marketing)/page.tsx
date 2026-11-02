import { Copy, FolderKanban, Mail, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PricingTable } from '@kit/billing-gateway/marketing';

import billingConfig from '~/config/billing.config';
import pathsConfig from '~/config/paths.config';

import {
  Band,
  BandBody,
  CtaBand,
  DisplayTitle,
  GrayCard,
  PillLink,
  SectionIntro,
} from './_components/el';
import {
  BeamScene,
  FiltersScene,
  FormScene,
  LineArt,
  PilotScene,
  RobotScene,
} from './_components/scenes';

/**
 * Page d'accueil Prospectigo, DA « façon ElevenLabs » (relooking du 2/11/2026)
 * et visuels « façon Apollo » (scenes.tsx). Les textes vivent dans
 * marketing.json.
 */
async function Home() {
  const t = await getTranslations('marketing.home');
  const tCommon = await getTranslations('common');

  const steps = [
    { key: 'step1', art: 'target' },
    { key: 'step2', art: 'find' },
    { key: 'step3', art: 'contact' },
  ] as const;

  const smallFeatures = [
    { key: 'feature3', icon: <Copy /> },
    { key: 'feature4', icon: <ShieldCheck /> },
    { key: 'feature5', icon: <FolderKanban /> },
    { key: 'feature6', icon: <Mail /> },
  ] as const;

  const activities = t.raw('activities') as string[];

  return (
    <div className={'flex flex-col'}>
      {/* Héros : titre fin à gauche, phrase à droite, deux pilules, puis le
          robot au travail sur le fond liquide */}
      <Band topRule={false} innerClassName={'sm:border-x-0'}>
        <div className={'flex flex-col gap-y-12 pt-16 pb-20 md:pt-28'}>
          <div className={'grid gap-x-12 gap-y-6 md:grid-cols-2'}>
            <div className={'flex flex-col gap-y-6'}>
              <DisplayTitle as={'h1'} size={'page'}>
                {t.rich('title', { hl: (chunks) => <>{chunks}</> })}
              </DisplayTitle>

              <div className={'flex flex-wrap gap-2'}>
                <PillLink href={pathsConfig.auth.signUp} size={'lg'}>
                  {tCommon('getStarted')}
                </PillLink>
                <PillLink href={'/pricing'} size={'lg'} variant={'secondary'}>
                  {t('seePricing')}
                </PillLink>
              </div>
            </div>

            <p
              className={
                'text-base leading-[1.5] tracking-[0.01em] md:pt-2.5 md:text-[1.0625rem]'
              }
            >
              {t('subtitle')}
            </p>
          </div>

          <RobotScene />
        </div>
      </Band>

      {/* Bande « logos » : chez nous, les activités qu'on trouve sur Google Maps */}
      <Band>
        <div
          className={
            'flex flex-wrap items-center justify-between gap-4 py-8 sm:px-7'
          }
        >
          <p className={'text-base tracking-[0.01em]'}>
            {t('activitiesTitle')}
          </p>
          <PillLink href={'/pricing'} variant={'secondary'} size={'md'}>
            {t('seePricing')}
          </PillLink>
        </div>
      </Band>
      <section
        className={
          'border-hairline border-y bg-stone-50 px-4 sm:px-6 dark:bg-stone-950'
        }
      >
        <ul
          className={
            'border-hairline mx-auto grid max-w-[62rem] grid-cols-2 gap-y-2 py-8 sm:grid-cols-3 sm:border-x md:grid-cols-6'
          }
        >
          {activities.map((activity) => (
            <li
              key={activity}
              className={
                'px-2 py-2.5 text-center text-[0.9375rem] font-medium tracking-[-0.01em] text-stone-400 dark:text-stone-500'
              }
            >
              {activity}
            </li>
          ))}
        </ul>
      </section>

      {/* Comment ça marche */}
      <Band topRule={false}>
        <BandBody>
          <SectionIntro eyebrow={t('howTitle')} title={t('howSubtitle')} />

          <div className={'mt-10 grid gap-2.5 sm:-mx-4 md:grid-cols-3'}>
            {steps.map((step) => (
              <GrayCard
                key={step.key}
                visual={<LineArt kind={step.art} />}
                label={t(`${step.key}Label`)}
                description={t(step.key)}
              />
            ))}
          </div>
        </BandBody>
      </Band>

      {/* Fonctionnalités : deux grandes cartes, puis quatre petites */}
      <Band>
        <BandBody>
          <SectionIntro
            eyebrow={t('featuresIcon')}
            title={t('featuresTitle')}
            intro={t('featuresSubtitle')}
            actions={
              <PillLink href={pathsConfig.auth.signUp} size={'lg'}>
                {tCommon('getStarted')}
              </PillLink>
            }
          />

          <div className={'mt-10 flex flex-col gap-2.5 sm:-mx-4'}>
            <div className={'grid gap-2.5 md:grid-cols-2'}>
              <GrayCard
                className={'min-h-[28rem]'}
                label={t('feature1Label')}
                description={t('feature1')}
                visual={<BeamScene />}
              />
              <GrayCard
                className={'min-h-[28rem]'}
                label={t('feature2Label')}
                description={t('feature2')}
                visual={<FormScene />}
              />
            </div>

            <div className={'grid gap-2.5 sm:grid-cols-2 md:grid-cols-4'}>
              {smallFeatures.map((feature) => (
                <GrayCard
                  key={feature.key}
                  icon={feature.icon}
                  label={t(`${feature.key}Label`)}
                  description={t(feature.key)}
                />
              ))}
            </div>
          </div>
        </BandBody>
      </Band>

      {/* Contrôle : les filtres et le pilote automatique */}
      <Band>
        <BandBody>
          <SectionIntro
            eyebrow={t('controlEyebrow')}
            title={t('controlTitle')}
            intro={t('controlText')}
          />

          <div className={'mt-10 grid gap-2.5 sm:-mx-4 md:grid-cols-2'}>
            <GrayCard
              className={'min-h-[28rem]'}
              label={t('controlCard1Label')}
              description={t('controlCard1')}
              visual={<FiltersScene />}
            />
            <GrayCard
              className={'min-h-[28rem]'}
              label={t('controlCard2Label')}
              description={t('controlCard2')}
              visual={<PilotScene />}
            />
          </div>
        </BandBody>
      </Band>

      {/* Tarifs */}
      <Band>
        <BandBody>
          <SectionIntro
            eyebrow={t('pricingPill')}
            title={t('pricingTitle')}
            intro={
              <>
                {t('pricingSubtitle')}{' '}
                <span className={'text-muted-foreground'}>
                  {t('pricingPillText')}.
                </span>
              </>
            }
            actions={
              <PillLink href={'/pricing'} variant={'secondary'} size={'md'}>
                {t('pricingMore')}
              </PillLink>
            }
          />

          <div className={'mt-10 sm:-mx-4'}>
            <PricingTable
              config={billingConfig}
              paths={{
                signUp: pathsConfig.auth.signUp,
                return: pathsConfig.app.home,
              }}
            />
          </div>
        </BandBody>
      </Band>

      {/* Bandeau final sur le fond liquide */}
      <CtaBand
        title={t('ctaTitle')}
        primary={{
          href: pathsConfig.auth.signUp,
          label: tCommon('getStarted'),
        }}
        secondary={{ href: '/contact', label: tCommon('contactUs') }}
      />
    </div>
  );
}

export default Home;
