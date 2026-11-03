import type { ReactNode } from 'react';

import {
  CalendarClock,
  ChartColumn,
  ChartNoAxesColumn,
  Download,
  Globe,
  House,
  LayoutGrid,
  List,
  Mail,
  MapPin,
  Send,
  SlidersHorizontal,
  Split,
  Target,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@kit/ui/utils';

import { AppLogo } from '~/components/app-logo';
import pathsConfig from '~/config/paths.config';

import { PillLink } from '../el';

/**
 * Page d'accueil « façon Apollo en bleu » (3/11/2026), section par section
 * d'après la maquette validée par Gabriel et Nath. Styles : styles/home.css
 * (classes hp-*). Textes : marketing.json › homeV2. Mots interdits sur tout
 * le site : « scraping » et « Google Maps ».
 */

const BIG_PILL = 'h-12 px-6 text-[1.0625rem]';

type Rich = (chunks: ReactNode) => ReactNode;

const bold: Rich = (chunks) => <b>{chunks}</b>;
const variable: Rich = (chunks) => (
  <span className={'hp-var'}>
    {'{'}
    {chunks}
    {'}'}
  </span>
);

/* ———————————————————— 1. Hero ———————————————————— */

export function HomeHero() {
  const t = useTranslations('marketing.homeV2');

  return (
    <section className={'hp-gut'}>
      <div className={'hp-wrap hp-hero'}>
        <span className={'hp-eyebrow'}>{t('eyebrow')}</span>

        <h1 className={'hp-h1'}>{t('title')}</h1>

        <p className={'hp-lead'}>{t('lead')}</p>

        <div className={'flex flex-wrap justify-center gap-2.5'}>
          <PillLink href={pathsConfig.auth.signUp} className={BIG_PILL}>
            {t('start')}
          </PillLink>

          <PillLink href={'#demo'} variant={'secondary'} className={BIG_PILL}>
            {t('bookDemo')}
          </PillLink>
        </div>

        <span className={'hp-fine'}>{t('fine')}</span>
      </div>

      <div className={'hp-wrap hp-hero-panel hp-fluid'}>
        <div className={'hp-steps'} aria-hidden>
          <span style={{ '--d': '0s' } as React.CSSProperties}>
            {t('steps.target')}
          </span>
          <span style={{ '--d': '-8s' } as React.CSSProperties}>
            {t('steps.find')}
          </span>
          <span style={{ '--d': '-4s' } as React.CSSProperties}>
            {t('steps.contact')}
          </span>
        </div>

        <HeroApp />
      </div>
    </section>
  );
}

/** La fenêtre d'appli animée : Ciblez → Trouvez → Contactez (12 s). */
function HeroApp() {
  const t = useTranslations('marketing.homeV2');

  const prospects = [
    ['Bright Smile Dental', '4,8', 'brightsmile.com', true, '(512) 555-0142'],
    [
      'Lakeway Dental Studio',
      '4,6',
      'lakewaydental.com',
      true,
      '(512) 555-0187',
    ],
    [
      'South Congress Dentistry',
      '4,9',
      'socodentistry.com',
      true,
      '(512) 555-0110',
    ],
    ['Barton Creek Smiles', '4,7', 'bartoncreek.com', false, '(512) 555-0163'],
    ['Mueller Family Ortho', '4,8', 'muellerortho.com', true, '(512) 555-0129'],
  ] as const;

  const sends = [
    ['Bright Smile Dental', true],
    ['Lakeway Dental Studio', true],
    ['South Congress Dentistry', true],
    ['Mueller Family Ortho', false],
  ] as const;

  return (
    <div className={'hp-app'} role={'img'} aria-label={t('appAlt')}>
      <div className={'hp-app-bar'}>
        <i />
        <i />
        <i />
        <AppLogo href={null} className={'ml-2.5 text-sm'} />
      </div>

      <div className={'hp-app-body'}>
        <div className={'hp-app-side'}>
          <span>
            <House className={'size-5'} strokeWidth={1.5} />
          </span>
          <span data-on>
            <Target className={'size-5'} strokeWidth={1.5} />
          </span>
          <span>
            <List className={'size-5'} strokeWidth={1.5} />
          </span>
          <span>
            <Send className={'size-5'} strokeWidth={1.5} />
          </span>
          <span>
            <ChartNoAxesColumn className={'size-5'} strokeWidth={1.5} />
          </span>
        </div>

        <div className={'hp-app-main'}>
          {/* Scène 1 : Ciblez */}
          <div
            className={'hp-sc'}
            style={{ '--d': '0s' } as React.CSSProperties}
          >
            <div className={'hp-hd-row'}>
              <b>{t('app.newCampaign')}</b>
              <span className={'hp-chip hp-chip-sm'}>{t('app.stepBadge')}</span>
            </div>

            <div className={'hp-target-grid'}>
              <div className={'grid gap-3'}>
                <div className={'hp-field'}>
                  <small>{t('app.zone')}</small>
                  <div className={'hp-val'}>
                    <MapPin className={'size-[18px]'} strokeWidth={1.5} />
                    {t('app.zoneValue')}
                    <span className={'hp-chip hp-chip-sm'}>
                      {t('app.radius')}
                    </span>
                  </div>
                </div>

                <div className={'hp-field'}>
                  <small>{t('app.sector')}</small>
                  <div className={'hp-val'}>
                    <span className={'hp-chip hp-chip-blue hp-chip-sm'}>
                      {t('app.sector1')}
                    </span>
                    <span className={'hp-chip hp-chip-blue hp-chip-sm'}>
                      {t('app.sector2')}
                    </span>
                    <span className={'hp-chip hp-chip-line hp-chip-sm'}>
                      {t('app.add')}
                    </span>
                  </div>
                </div>

                <div className={'hp-field'}>
                  <small>{t('app.filters')}</small>
                  <div className={'hp-val hp-val-between'}>
                    {t('app.withWebsite')}
                    <span className={'hp-toggle'} />
                  </div>
                  <div className={'hp-val hp-val-between'}>
                    {t('app.rating')}
                    <span className={'hp-toggle'} />
                  </div>
                </div>
              </div>

              <MiniMap />
            </div>

            <div className={'hp-count'}>
              <span>
                <b>312</b>{' '}
                <span className={'text-(--hp-text-2)'}>
                  {t('app.matching')}
                </span>
              </span>
              <span className={'hp-btn-blue'}>{t('app.launch')}</span>
            </div>
          </div>

          {/* Scène 2 : Trouvez */}
          <div
            className={'hp-sc'}
            style={{ '--d': '-8s' } as React.CSSProperties}
          >
            <div className={'hp-hd-row'}>
              <b>{t('app.qualified')}</b>
              <span className={'flex gap-1.5'}>
                <span className={'hp-chip hp-chip-line hp-chip-sm'}>
                  {t('app.add')}
                </span>
                <span className={'hp-chip hp-chip-line hp-chip-sm'}>
                  {t('app.export')}
                </span>
              </span>
            </div>

            <div className={'hp-table'}>
              <div className={'hp-tr hp-th'}>
                <span>{t('app.colCompany')}</span>
                <span>{t('app.colRating')}</span>
                <span>{t('app.colWebsite')}</span>
                <span className={'hp-c4'}>{t('app.colEmail')}</span>
                <span className={'hp-c5'}>{t('app.colPhone')}</span>
              </div>

              {prospects.map(([name, rating, site, found, phone], index) => (
                <div
                  key={name}
                  className={'hp-tr hp-rise'}
                  style={
                    { '--d': `${-7.8 + index * 0.3}s` } as React.CSSProperties
                  }
                >
                  <span className={'hp-nm'}>{name}</span>
                  <span>★ {rating}</span>
                  <span>{site}</span>
                  <span
                    className={cn(
                      'hp-c4',
                      found ? 'hp-ok' : 'text-(--hp-muted)',
                    )}
                  >
                    {found ? t('app.found') : t('app.searching')}
                  </span>
                  <span className={'hp-c5'}>{phone}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Scène 3 : Contactez */}
          <div
            className={'hp-sc'}
            style={{ '--d': '-4s' } as React.CSSProperties}
          >
            <div className={'hp-hd-row'}>
              <b>{t('app.campaign')}</b>
              <span className={'hp-chip hp-chip-sm gap-2'}>
                <span className={'hp-live'} />
                {t('app.sending')}
              </span>
            </div>

            <div className={'hp-msg-grid'}>
              <div>
                <div className={'hp-tabs'}>
                  <span data-on>{t('app.messageA')}</span>
                  <span>{t('app.messageB')}</span>
                </div>

                <div className={'hp-editor'}>
                  {t.rich('app.message', { v: variable })}
                </div>

                <div className={'mt-2.5 flex flex-wrap gap-1.5'}>
                  <span className={'hp-chip hp-chip-sm'}>
                    {t('app.sender')}
                  </span>
                  <span className={'hp-chip hp-chip-sm'}>
                    {t('app.schedule')}
                  </span>
                </div>
              </div>

              <div className={'hp-log'}>
                <div className={'mb-1 grid gap-2'}>
                  <div className={'flex justify-between text-sm'}>
                    <span>{t('app.today')}</span>
                    <span className={'text-(--hp-muted)'}>
                      {t('app.sentCount')}
                    </span>
                  </div>
                  <div className={'hp-progress'}>
                    <i />
                  </div>
                </div>

                {sends.map(([name, sent], index) => (
                  <div
                    key={name}
                    className={'hp-card-flat hp-log-row hp-rise'}
                    style={
                      { '--d': `${-3.6 + index * 0.5}s` } as React.CSSProperties
                    }
                  >
                    <span>{name}</span>
                    <span
                      className={cn(
                        'hp-chip hp-chip-sm',
                        sent ? 'hp-chip-solid' : 'hp-chip-blue',
                      )}
                    >
                      {sent ? t('app.sent') : t('app.inProgress')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniMap() {
  return (
    <div className={'hp-mini-map'} aria-hidden>
      <svg viewBox={'0 0 300 260'} preserveAspectRatio={'xMidYMid slice'}>
        <rect width={300} height={260} fill={'var(--hp-cream-2)'} />
        <g stroke={'var(--hp-card)'} strokeWidth={7} fill={'none'}>
          <path d={'M0 70H300M0 170H300M80 0V260M200 0V260'} />
          <path d={'M0 240 300 20'} strokeWidth={9} />
        </g>
        <g stroke={'var(--hp-card)'} strokeWidth={3} fill={'none'}>
          <path d={'M0 120H300M0 215H300M35 0V260M140 0V260M250 0V260'} />
        </g>
        <circle
          className={'hp-radius'}
          cx={150}
          cy={130}
          r={88}
          fill={'color-mix(in srgb, var(--hp-blue) 14%, transparent)'}
          stroke={'var(--hp-blue)'}
          strokeWidth={1.5}
          strokeDasharray={'5 5'}
        />
        <circle
          cx={150}
          cy={130}
          r={7}
          fill={'var(--hp-blue)'}
          stroke={'#fff'}
          strokeWidth={3}
        />
      </svg>
    </div>
  );
}

/* ———————————————————— 2. Secteurs ———————————————————— */

export function HomeSectors() {
  const t = useTranslations('marketing.homeV2');
  const sectors = t.raw('sectors') as string[];

  return (
    <section className={'hp-strip'}>
      <span className={'hp-eyebrow hp-gut'}>{t('sectorsEyebrow')}</span>

      <div className={'hp-marq'}>
        <div className={'hp-marq-track'}>
          {[...sectors, ...sectors].map((sector, index) => (
            <span
              key={index}
              aria-hidden={index >= sectors.length || undefined}
            >
              {sector}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ———————————————————— 3. Concept ———————————————————— */

export function HomeConcept() {
  const t = useTranslations('marketing.homeV2.concept');

  const steps = [
    { key: 'target', num: '01', art: <TargetArt /> },
    { key: 'find', num: '02', art: <FindArt /> },
    { key: 'contact', num: '03', art: <ContactArt /> },
  ] as const;

  return (
    <section className={'hp-gut'} id={'fonctionnement'}>
      <div className={'hp-wrap hp-how'}>
        <span className={'hp-eyebrow'}>{t('eyebrow')}</span>
        <h2 className={'hp-h2'}>{t('title')}</h2>
        <p className={'hp-body-2 max-w-[48ch]'}>{t('text')}</p>

        <div className={'hp-loop'}>
          <span
            className={'hp-arrow'}
            style={{ left: 'calc(33.3% - 8px)', top: -8 }}
            aria-hidden
          >
            ›
          </span>
          <span
            className={'hp-arrow'}
            style={{ left: 'calc(66.6% - 8px)', top: -8 }}
            aria-hidden
          >
            ›
          </span>
          <span
            className={'hp-arrow'}
            style={{ left: 'calc(50% - 8px)', bottom: -8 }}
            aria-hidden
          >
            ‹
          </span>

          <div className={'hp-loop-cards'}>
            {steps.map((step) => (
              <div key={step.key} className={'hp-step'}>
                <span className={'hp-fine'}>{step.num}</span>
                <h3>{t(`${step.key}Title`)}</h3>
                <p>{t(`${step.key}Text`)}</p>
                {step.art}
                <div className={'hp-step-tags'}>
                  {(t.raw(`${step.key}Tags`) as string[]).map((tag) => (
                    <span key={tag} className={'hp-chip'}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TargetArt() {
  return (
    <svg className={'hp-ill'} viewBox={'0 0 132 112'} aria-hidden>
      <ellipse className={'s'} cx={66} cy={92} rx={44} ry={11} />
      <ellipse
        className={'k'}
        cx={66}
        cy={92}
        rx={44}
        ry={11}
        strokeDasharray={'3 4'}
      />
      <path
        className={'b'}
        d={'M66 88c-3-5-18-20-18-34a18 18 0 0 1 36 0c0 14-15 29-18 34z'}
      />
      <path
        className={'k'}
        d={'M66 88c-3-5-18-20-18-34a18 18 0 0 1 36 0c0 14-15 29-18 34z'}
      />
      <circle className={'w'} cx={66} cy={53} r={7} />
      <circle className={'k'} cx={66} cy={53} r={7} />
      <path
        className={'k'}
        d={'M100 24l3 -7M108 32l7 -3M104 18l2 2M26 30l-4 -4M22 40h-6'}
      />
    </svg>
  );
}

function FindArt() {
  return (
    <svg className={'hp-ill'} viewBox={'0 0 132 112'} aria-hidden>
      <rect className={'w'} x={18} y={40} width={64} height={52} rx={3} />
      <path className={'k'} d={'M18 92V40h64v52z'} />
      <path className={'b'} d={'M14 40l6-14h60l6 14z'} />
      <path
        className={'k'}
        d={
          'M14 40l6-14h60l6 14zM30 26l-3 14M42 26v14M58 26v14M70 26l3 14M30 92V64h16v28M56 60h16v12H56z'
        }
      />
      <circle className={'w'} cx={92} cy={64} r={17} />
      <circle className={'k'} cx={92} cy={64} r={17} />
      <circle className={'s'} cx={92} cy={64} r={11} />
      <path className={'k'} d={'M104 77l14 14'} strokeWidth={4} />
      <path className={'k'} d={'M112 26l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'} />
    </svg>
  );
}

function ContactArt() {
  return (
    <svg className={'hp-ill'} viewBox={'0 0 132 112'} aria-hidden>
      <rect className={'w'} x={20} y={22} width={56} height={72} rx={4} />
      <rect className={'k'} x={20} y={22} width={56} height={72} rx={4} />
      <path className={'k'} d={'M30 36h36M30 48h36M30 60h24'} />
      <rect className={'s'} x={30} y={72} width={26} height={10} rx={5} />
      <path className={'b'} d={'M70 58l50-26-18 52-12-14z'} />
      <path className={'k'} d={'M70 58l50-26-18 52-12-14zM90 70l30-38'} />
      <path
        className={'k'}
        d={'M58 78c-8 6-16 8-26 8M64 92c-6 3-12 4-18 4'}
        strokeDasharray={'2 4'}
      />
    </svg>
  );
}

/* ———————————————————— 4, 5, 7. Lignes de fonctionnalités ———————————————————— */

function FeatureRow({
  id,
  flip,
  eyebrow,
  title,
  text,
  bullets,
  cta,
  visual,
}: {
  id: string;
  flip?: boolean;
  eyebrow: string;
  title: string;
  text: string;
  bullets: { icon: ReactNode; text: ReactNode }[];
  cta: { href: string; label: string };
  visual: ReactNode;
}) {
  return (
    <div className={cn('hp-feat', flip && 'hp-feat-flip')} id={id}>
      <div className={'hp-feat-copy'}>
        <div className={'hp-feat-top'}>
          <span className={'hp-eyebrow'}>{eyebrow}</span>
          <h2 className={'hp-h3'}>{title}</h2>
          <p className={'hp-body'}>{text}</p>
        </div>

        <span />

        <div className={'grid gap-7'}>
          <ul className={'hp-flist'}>
            {bullets.map((bullet, index) => (
              <li key={index}>
                {bullet.icon}
                <span>{bullet.text}</span>
              </li>
            ))}
          </ul>

          <div>
            <PillLink
              href={cta.href}
              variant={'secondary'}
              size={'md'}
              className={'h-10 px-[18px] text-base'}
            >
              {cta.label}
            </PillLink>
          </div>
        </div>
      </div>

      <div className={'hp-panel hp-visual'}>{visual}</div>
    </div>
  );
}

export function HomeTargetAndFind() {
  const t = useTranslations('marketing.homeV2');

  return (
    <section className={'hp-gut'}>
      <div className={'hp-wrap hp-feats'}>
        <FeatureRow
          id={'cibler'}
          eyebrow={t('target.eyebrow')}
          title={t('target.title')}
          text={t('target.text')}
          bullets={[
            { icon: <Globe />, text: t.rich('target.zone', { b: bold }) },
            {
              icon: <LayoutGrid />,
              text: t.rich('target.sectors', { b: bold }),
            },
            {
              icon: <SlidersHorizontal />,
              text: t.rich('target.filters', { b: bold }),
            },
          ]}
          cta={{ href: pathsConfig.auth.signUp, label: t('target.cta') }}
          visual={<TargetVisual />}
        />

        <FeatureRow
          id={'trouver'}
          flip
          eyebrow={t('find.eyebrow')}
          title={t('find.title')}
          text={t('find.text')}
          bullets={[
            { icon: <List />, text: t.rich('find.manage', { b: bold }) },
            { icon: <Mail />, text: t.rich('find.enrich', { b: bold }) },
            { icon: <Download />, text: t.rich('find.export', { b: bold }) },
          ]}
          cta={{ href: pathsConfig.auth.signUp, label: t('find.cta') }}
          visual={<FindVisual />}
        />
      </div>
    </section>
  );
}

function TargetVisual() {
  const t = useTranslations('marketing.homeV2.target.ui');
  const modes = t.raw('modes') as string[];
  const cities = t.raw('cities') as string[];
  const sectors = t.raw('sectors') as string[];

  return (
    <div className={'hp-vin grid gap-3.5'}>
      <div className={'hp-card grid gap-3 p-4'}>
        <div className={'hp-field hp-field-bare'}>
          <small>{t('zone')}</small>
          <div className={'hp-val gap-1.5'}>
            {modes.map((mode, index) => (
              <span
                key={mode}
                className={cn(
                  'hp-chip hp-chip-sm',
                  index === 1 ? 'hp-chip-solid' : 'hp-chip-line',
                )}
              >
                {mode}
              </span>
            ))}
          </div>
          <div className={'hp-val gap-1.5'}>
            {cities.map((city) => (
              <span key={city} className={'hp-chip hp-chip-sm'}>
                {city}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={'hp-card p-4'}>
        <div className={'hp-field hp-field-bare'}>
          <small>{t('sector')}</small>
          <div className={'hp-val gap-1.5'}>
            {sectors.map((sector, index) => (
              <span
                key={sector}
                className={cn(
                  'hp-chip hp-chip-sm',
                  index < 2 ? 'hp-chip-blue' : 'hp-chip-line',
                )}
              >
                {sector}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={'hp-lisere'}>
        <div className={'hp-card grid gap-3 p-4'}>
          <div className={'hp-field hp-field-bare'}>
            <small>{t('filters')}</small>
            <div className={'hp-val hp-val-between'}>
              {t('withWebsite')}
              <span className={'hp-toggle'} />
            </div>
            <div className={'hp-val hp-val-between'}>
              {t('rating')}
              <span className={'hp-toggle'} />
            </div>
            <div className={'hp-val hp-val-between'}>
              {t('reviews')}
              <span className={'hp-toggle hp-toggle-off'} />
            </div>
          </div>

          <div className={'hp-count mt-0.5'}>
            <span>
              <b>1 284</b>{' '}
              <span className={'text-(--hp-text-2)'}>{t('count')}</span>
            </span>
            <span className={'hp-chip hp-chip-blue hp-chip-sm'}>
              {t('live')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FindVisual() {
  const t = useTranslations('marketing.homeV2.find.ui');

  return (
    <div className={'hp-vin hp-lisere'}>
      <div className={'hp-card grid gap-3 p-4'}>
        <div className={'hp-hd-row m-0'}>
          <b className={'text-base'}>{t('list')}</b>
          <span className={'flex gap-1.5'}>
            <span className={'hp-chip hp-chip-line hp-chip-sm'}>
              {t('add')}
            </span>
            <span className={'hp-chip hp-chip-line hp-chip-sm'}>
              {t('export')}
            </span>
          </span>
        </div>

        <div className={'grid gap-2'}>
          <div className={'hp-card-flat grid gap-1.5 px-3.5 py-3'}>
            <div className={'flex flex-wrap justify-between gap-2'}>
              <b className={'font-medium text-(--hp-ink)'}>
                Bright Smile Dental
              </b>
              <span className={'text-sm text-(--hp-text-2)'}>
                {t('reviews1')}
              </span>
            </div>
            <div className={'flex flex-wrap gap-1.5'}>
              <span className={'hp-chip hp-chip-sm'}>brightsmile.com</span>
              <span className={'hp-chip hp-chip-green hp-chip-sm'}>
                ✓ contact@brightsmile.com
              </span>
              <span className={'hp-chip hp-chip-sm'}>(512) 555-0142</span>
            </div>
          </div>

          <div className={'hp-card-flat grid gap-1.5 px-3.5 py-3'}>
            <div className={'flex flex-wrap justify-between gap-2'}>
              <b className={'font-medium text-(--hp-ink)'}>
                Lakeway Dental Studio
              </b>
              <span className={'text-sm text-(--hp-text-2)'}>
                {t('reviews2')}
              </span>
            </div>
            <div className={'flex flex-wrap gap-1.5'}>
              <span className={'hp-chip hp-chip-sm'}>lakewaydental.com</span>
              <span className={'hp-chip hp-chip-blue hp-chip-sm'}>
                {t('findEmail')}
              </span>
              <span className={'hp-chip hp-chip-sm'}>(512) 555-0187</span>
            </div>
          </div>

          <div className={'hp-card-flat grid gap-1.5 px-3.5 py-3 opacity-60'}>
            <div className={'flex flex-wrap justify-between gap-2'}>
              <b className={'font-medium text-(--hp-ink) line-through'}>
                Downtown Dental Group
              </b>
              <span className={'text-sm text-(--hp-text-2)'}>
                {t('removed')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ———————————————————— 6. Démo ———————————————————— */

export function HomeDemo() {
  const t = useTranslations('marketing.homeV2.demo');

  return (
    <section className={'hp-gut'} id={'demo'}>
      <div className={'hp-wrap hp-demo'}>
        <div className={'hp-ghost'} aria-hidden>
          <div />
          <div className={'hp-ghost-main'}>
            <div className={'hp-ghost-bar'} />
            <div className={'hp-ghost-cards'}>
              <div />
              <div />
              <div />
            </div>
            <div className={'hp-ghost-table'} />
          </div>
        </div>

        <div className={'hp-demo-card'}>
          <span className={'hp-eyebrow'}>{t('eyebrow')}</span>
          <h2 className={'hp-h2'}>{t('title')}</h2>
          <p className={'hp-body-2 max-w-[40ch]'}>{t('text')}</p>

          {/* En attendant un outil de prise de rendez-vous (Calendly, Cal.com…),
              la démo se demande depuis la page Contact. */}
          <PillLink href={'/contact'} className={BIG_PILL}>
            {t('cta')}
          </PillLink>

          <span className={'hp-fine'}>{t('fine')}</span>
        </div>
      </div>
    </section>
  );
}

/* ———————————————————— 7. Contacter ———————————————————— */

export function HomeContact() {
  const t = useTranslations('marketing.homeV2');

  return (
    <section className={'hp-gut'}>
      <div className={'hp-wrap hp-feats'}>
        <FeatureRow
          id={'contacter'}
          eyebrow={t('contact.eyebrow')}
          title={t('contact.title')}
          text={t('contact.text')}
          bullets={[
            { icon: <User />, text: t.rich('contact.sender', { b: bold }) },
            { icon: <Split />, text: t.rich('contact.ab', { b: bold }) },
            {
              icon: <CalendarClock />,
              text: t.rich('contact.schedule', { b: bold }),
            },
          ]}
          cta={{ href: '#demo', label: t('contact.cta') }}
          visual={<ContactVisual />}
        />
      </div>
    </section>
  );
}

function ContactVisual() {
  const t = useTranslations('marketing.homeV2.contact.ui');

  const line = <div className={'hp-link-line'} />;

  return (
    <div className={'hp-vin grid justify-items-stretch'}>
      <div className={'hp-card flex items-center gap-3 px-4 py-3.5'}>
        <span className={'hp-chip hp-chip-blue hp-chip-icon'}>
          <User className={'size-4'} strokeWidth={1.5} />
        </span>
        <span className={'min-w-0 flex-1'}>
          <b className={'font-medium text-(--hp-ink)'}>{t('sender')}</b>
          <br />
          <span className={'text-sm text-(--hp-muted)'}>
            {t('senderValue')}
          </span>
        </span>
        <span className={'hp-chip hp-chip-green hp-chip-sm'}>{t('ready')}</span>
      </div>

      {line}

      <div className={'hp-lisere'}>
        <div className={'hp-card grid gap-2.5 px-4 py-3.5'}>
          <div className={'flex items-center gap-3'}>
            <span className={'hp-chip hp-chip-blue hp-chip-icon'}>
              <Split className={'size-4'} strokeWidth={1.5} />
            </span>
            <b className={'flex-1 font-medium text-(--hp-ink)'}>
              {t('messages')}
            </b>
            <span className={'hp-chip hp-chip-sm'}>{t('versions')}</span>
          </div>
          <div className={'text-sm leading-normal text-(--hp-text-2)'}>
            {t.rich('message', { v: variable })}
          </div>
        </div>
      </div>

      {line}

      <div className={'hp-card flex items-center gap-3 px-4 py-3.5'}>
        <span className={'hp-chip hp-chip-blue hp-chip-icon'}>
          <CalendarClock className={'size-4'} strokeWidth={1.5} />
        </span>
        <span className={'min-w-0 flex-1'}>
          <b className={'font-medium text-(--hp-ink)'}>{t('schedule')}</b>
          <br />
          <span className={'text-sm text-(--hp-muted)'}>
            {t('scheduleValue')}
          </span>
        </span>
      </div>

      {line}

      <div className={'hp-card grid gap-2.5 px-4 py-3.5'}>
        <div className={'flex items-center gap-3'}>
          <span className={'hp-live'} />
          <b className={'flex-1 font-medium text-(--hp-ink)'}>{t('auto')}</b>
          <span className={'text-sm text-(--hp-muted)'}>{t('autoCount')}</span>
        </div>
        <div className={'hp-progress'}>
          <i />
        </div>
      </div>
    </div>
  );
}

/* ———————————————————— 8. Quatre cartes ———————————————————— */

export function HomeCards() {
  const t = useTranslations('marketing.homeV2.cards');

  const cards = [
    { key: 'senders', icon: <User /> },
    { key: 'ab', icon: <Split />, extra: true },
    { key: 'results', icon: <ChartColumn /> },
    { key: 'bulk', icon: <Send /> },
  ] as const;

  return (
    <section className={'hp-band hp-gut'}>
      <div className={'hp-wrap'}>
        <div className={'hp-band-head'}>
          <span className={'hp-eyebrow'}>{t('eyebrow')}</span>
          <h2 className={'hp-h2 max-w-[20ch]'}>{t('title')}</h2>
          <p className={'hp-body-2 max-w-[48ch]'}>{t('text')}</p>
        </div>

        <div className={'hp-grid4'}>
          {cards.map((card) => (
            <div key={card.key} className={'hp-card4'}>
              {card.icon}
              <p className={'hp-t24'}>{t(card.key)}</p>
              <p>{t(`${card.key}Text`)}</p>
              {'extra' in card ? (
                <div
                  className={'mt-auto flex flex-wrap gap-1.5 pt-2.5'}
                  aria-hidden
                >
                  <span className={'hp-chip hp-chip-sm'}>A · 6,1 %</span>
                  <span className={'hp-chip hp-chip-blue hp-chip-sm'}>
                    B · 8,4 % ↑
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ———————————————————— 9. Bandeau final ———————————————————— */

export function HomeFinalCta() {
  const t = useTranslations('marketing.homeV2');

  return (
    <section className={'hp-gut'}>
      <div className={'hp-wrap hp-cta hp-fluid'}>
        <h2 className={'hp-h1'}>{t('final.title')}</h2>
        <p>{t('final.text')}</p>

        <div className={'flex flex-wrap gap-2.5'}>
          <PillLink
            href={pathsConfig.auth.signUp}
            variant={'secondary'}
            className={BIG_PILL}
          >
            {t('start')}
          </PillLink>
          <PillLink
            href={'#demo'}
            className={cn(BIG_PILL, 'bg-black text-white hover:bg-stone-700')}
          >
            {t('bookDemo')}
          </PillLink>
        </div>

        <span className={'hp-fine text-white/80'}>{t('fine')}</span>
      </div>
    </section>
  );
}
