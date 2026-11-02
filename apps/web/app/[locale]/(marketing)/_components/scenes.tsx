import { Check, MapPin } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@kit/ui/utils';

/**
 * Visuels du site vitrine « façon Apollo » (2/11/2026) : de petites scènes
 * d'interface dessinées en code, posées sur un fond gris ou sur le fond liquide
 * irisé de la marque. Les styles partagés (dégradé, liseré, animations) sont
 * dans styles/visuals.css. Les noms d'entreprises sont des exemples.
 */

const uiCard =
  'bg-card border-border/80 rounded-[0.875rem] border shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.16)]';

function Chip({
  tone = 'neutral',
  className,
  children,
}: React.PropsWithChildren<{
  tone?: 'neutral' | 'ok' | 'live';
  className?: string;
}>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-[0.3rem] font-mono text-[0.625rem] leading-none tracking-[0.06em] whitespace-nowrap uppercase',
        {
          'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400':
            tone === 'neutral',
          'bg-[#e3f6d8] text-[#2f6b12] dark:bg-[#1f3a14] dark:text-[#a8e08a]':
            tone === 'ok',
          'bg-[#ffe1d3] text-[#b23300] dark:bg-[#4a1d0a] dark:text-[#ffb08a]':
            tone === 'live',
        },
        className,
      )}
    >
      {children}
    </span>
  );
}

function Tile({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <span
      className={cn(
        'font-heading flex size-8 shrink-0 items-center justify-center rounded-lg text-sm',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* A · Le robot au travail (haut de la page d'accueil)                       */
/* ------------------------------------------------------------------------ */

const robotSteps = [
  { x: '7%', y: '14%' },
  { x: '52%', y: '10%' },
  { x: '22%', y: '40%' },
  { x: '62%', y: '50%' },
  { x: '9%', y: '66%' },
] as const;

export function RobotScene() {
  const t = useTranslations('marketing.home.scenes');

  return (
    <div
      aria-hidden
      className={
        'bg-fluid relative h-[25rem] overflow-hidden rounded-2xl sm:h-[30rem] md:h-[34rem]'
      }
    >
      <ol
        className={
          'flex flex-col gap-y-4 p-6 sm:absolute sm:inset-0 sm:block sm:p-0'
        }
      >
        {robotSteps.map((step, index) => (
          <li
            key={index}
            className={
              'scene-step flex items-center gap-x-3 font-mono text-[0.6875rem] leading-[1.25] tracking-[0.06em] text-black/30 uppercase sm:absolute sm:top-(--y) sm:left-(--x) sm:text-[0.8125rem]'
            }
            style={
              {
                '--x': step.x,
                '--y': step.y,
                animationDelay: `${index * 2.5}s`,
              } as React.CSSProperties
            }
          >
            <span
              className={'relative size-2.5 shrink-0 rounded-full bg-black'}
            >
              <span
                className={
                  'scene-ring absolute -inset-2.5 rounded-full border border-black/25 opacity-0'
                }
                style={{ animationDelay: `${index * 2.5}s` }}
              />
              <span
                className={
                  'scene-ring absolute -inset-[1.125rem] rounded-full border border-black/15 opacity-0'
                }
                style={{ animationDelay: `${index * 2.5}s` }}
              />
            </span>

            <span>
              {t(`robotStep${index + 1}`)}
              <br />
              {t(`robotStep${index + 1}Detail`)}
            </span>
          </li>
        ))}
      </ol>

      <div
        className={
          'absolute bottom-5 left-1/2 flex w-[calc(100%-2rem)] max-w-[36rem] -translate-x-1/2 items-center gap-x-3.5 rounded-[1.125rem] border border-white/70 bg-white/85 py-3 pr-5 pl-3 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.2)] backdrop-blur-md sm:bottom-8'
        }
      >
        <span
          className={
            'bg-brand flex size-10 shrink-0 items-center justify-center rounded-full text-white'
          }
        >
          <MapPin className={'size-[1.125rem]'} />
        </span>

        <span
          className={
            'font-heading text-[0.9375rem] leading-[1.3] tracking-[-0.01em] text-stone-900 sm:text-lg'
          }
        >
          {t('robotSummary')}{' '}
          <span className={'text-stone-400'}>{t('robotNext')}</span>
          <span
            className={
              'scene-caret bg-brand ml-0.5 inline-block h-4 w-px align-[-2px]'
            }
          />
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* B · Tout converge vers une fiche                                          */
/* ------------------------------------------------------------------------ */

const fanIn = [
  [20, 96],
  [55, 96],
  [96, 96],
  [130, 96],
  [140, 160],
  [180, 160],
  [196, 224],
  [240, 224],
  [290, 224],
] as const;

export function BeamScene() {
  const t = useTranslations('marketing.home.scenes');
  const tHome = useTranslations('marketing.home');
  const format = useFormatter();

  const sources = [
    { key: 'beamSource1', top: '30%' },
    { key: 'beamSource2', top: '50%' },
    { key: 'beamSource3', top: '70%' },
  ] as const;

  return (
    <div aria-hidden className={'relative isolate h-[19rem] w-full'}>
      <svg
        className={
          'absolute inset-0 hidden h-full w-full text-stone-300 sm:block dark:text-stone-700'
        }
        viewBox={'0 0 400 320'}
        preserveAspectRatio={'none'}
      >
        <g
          fill={'none'}
          stroke={'currentColor'}
          strokeWidth={1}
          vectorEffect={'non-scaling-stroke'}
        >
          {fanIn.map(([from, to], index) => (
            <path
              key={index}
              d={`M0 ${from} C24 ${from} 20 ${to} 40 ${to}`}
              vectorEffect={'non-scaling-stroke'}
            />
          ))}
          <path
            d={'M40 96 H150 C170 96 172 160 188 160'}
            vectorEffect={'non-scaling-stroke'}
          />
          <path d={'M40 160 H400'} vectorEffect={'non-scaling-stroke'} />
          <path
            d={'M40 224 H150 C170 224 172 160 188 160'}
            vectorEffect={'non-scaling-stroke'}
          />
        </g>
      </svg>

      {/* petits nœuds pastel posés sur les fils */}
      {[
        { left: '5.4%', top: '23.6%', color: 'var(--iri-3)' },
        { left: '5.4%', top: '53.1%', color: 'var(--iri-4)' },
        { left: '5.4%', top: '80.3%', color: 'var(--iri-2)' },
        { left: '47%', top: '50%', color: '#cfe9b8' },
      ].map((node, index) => (
        <span
          key={index}
          className={
            'absolute hidden size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-[2px] sm:block'
          }
          style={{ left: node.left, top: node.top, background: node.color }}
        />
      ))}

      {sources.map((source) => (
        <span
          key={source.key}
          className={
            'bg-card font-heading absolute left-[10%] hidden -translate-y-1/2 rounded-[0.625rem] border border-stone-300 px-3 py-2 text-[0.9375rem] leading-none tracking-[-0.01em] whitespace-nowrap sm:block dark:border-stone-700'
          }
          style={{ top: source.top }}
        >
          {t(source.key)}
        </span>
      ))}

      {/* Le positionnement (avec translate) reste sur un parent : une
          transformation sur la carte elle-même ferait passer le liseré
          par-dessus son fond blanc. */}
      <div
        className={
          'absolute top-1/2 left-1/2 isolate w-[min(17rem,92%)] -translate-x-1/2 -translate-y-1/2 sm:right-[3%] sm:left-auto sm:w-[46%] sm:translate-x-0'
        }
      >
        <div className={cn(uiCard, 'lisere p-3.5')}>
          <div className={'mb-2 flex items-center gap-x-2.5'}>
            <Tile
              className={
                'bg-stone-900 text-white dark:bg-white dark:text-black'
              }
            >
              B
            </Tile>
            <span
              className={
                'font-heading truncate text-[0.9375rem] leading-tight tracking-[-0.01em]'
              }
            >
              Bright Smile Dental
            </span>
          </div>

          <SceneRow label={t('rating')}>
            {format.number(4.8, { minimumFractionDigits: 1 })} ★ ·{' '}
            {tHome('demoReviews', { count: 312 })}
          </SceneRow>
          <SceneRow label={t('website')}>
            <span className={'text-muted-foreground truncate'}>
              brightsmile.com
            </span>
          </SceneRow>
          <SceneRow label={t('form')}>
            <Chip tone={'ok'}>
              {t('found')} <Check className={'size-2.5'} />
            </Chip>
          </SceneRow>
        </div>
      </div>
    </div>
  );
}

function SceneRow({
  label,
  children,
}: React.PropsWithChildren<{ label: string }>) {
  return (
    <div
      className={
        'border-border/70 flex items-center justify-between gap-x-2 border-t py-2 text-[0.8125rem] first-of-type:border-t-0'
      }
    >
      <span className={'shrink-0'}>{label}</span>
      <span className={'flex min-w-0 items-center'}>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* C · Les filtres, puis la liste                                            */
/* ------------------------------------------------------------------------ */

const listed = [
  { name: 'Bright Smile Dental', rating: 4.8, color: 'var(--iri-1)' },
  { name: 'Lakeline Family Dentistry', rating: 4.6, color: 'var(--iri-6)' },
  { name: 'Cedar Park Smiles', rating: 4.9, color: '#59544f' },
  { name: 'South Congress Dental', rating: 4.5, color: 'var(--iri-2)' },
  { name: 'Mueller Dental Studio', rating: 4.7, color: 'var(--iri-5)' },
  { name: 'Riverside Orthodontics', rating: 4.4, color: '#a59f97' },
] as const;

export function FiltersScene() {
  const t = useTranslations('marketing.home.scenes');
  const format = useFormatter();

  const filters = [
    { title: t('filterTrade'), value: t('filterTradeValue') },
    { title: t('filterArea'), value: t('filterAreaValue') },
    { title: t('filterRating'), value: t('filterRatingValue') },
    { title: t('filterWebsite'), value: t('filterWebsiteValue'), ok: true },
  ];

  return (
    <div aria-hidden className={'relative h-[19rem] w-full overflow-hidden'}>
      <div
        className={
          'absolute top-1 left-1/2 flex w-[min(17rem,92%)] -translate-x-1/2 flex-col sm:left-[3%] sm:w-[44%] sm:translate-x-0'
        }
      >
        {filters.map((filter, index) => (
          <div key={filter.title} className={'flex flex-col items-stretch'}>
            {index > 0 ? (
              <span
                className={
                  'relative mx-auto h-4 border-l border-dashed border-stone-300 after:absolute after:bottom-[3px] after:-left-[3.5px] after:size-1.5 after:rotate-45 after:border-r after:border-b after:border-stone-300 after:content-[""] dark:border-stone-700 dark:after:border-stone-700'
                }
              />
            ) : null}

            <div
              className={cn(
                uiCard,
                'flex items-center justify-between gap-x-2 px-3 py-2.5',
              )}
            >
              <span className={'truncate text-[0.8125rem]'}>
                {filter.title}
              </span>
              <Chip tone={filter.ok ? 'ok' : 'neutral'}>
                {filter.value}
                {filter.ok ? <Check className={'size-2.5'} /> : null}
              </Chip>
            </div>
          </div>
        ))}
      </div>

      <div
        className={cn(
          uiCard,
          'absolute top-6 left-[52%] hidden w-[60%] overflow-hidden rounded-r-none border-r-0 [mask-image:linear-gradient(#000_50%,transparent)] pt-3 sm:block',
        )}
      >
        <div
          className={
            'font-heading flex items-center gap-x-2 px-3.5 pb-2.5 text-[1.0625rem] tracking-[-0.01em]'
          }
        >
          {t('prospects')} <Chip>{format.number(248)}</Chip>
        </div>

        {listed.map((business) => (
          <div
            key={business.name}
            className={
              'border-border/70 flex items-center gap-x-2.5 border-t px-3.5 py-2.5 text-[0.75rem] whitespace-nowrap'
            }
          >
            <span
              className={
                'flex size-6 shrink-0 items-center justify-center rounded-md text-[0.6875rem] text-white'
              }
              style={{ background: business.color }}
            >
              {business.name[0]}
            </span>
            <span className={'truncate'}>{business.name}</span>
            <span className={'text-muted-foreground ml-auto pr-1'}>
              {format.number(business.rating, { minimumFractionDigits: 1 })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* D · Le formulaire rempli                                                  */
/* ------------------------------------------------------------------------ */

export function FormScene() {
  const t = useTranslations('marketing.home.scenes');
  const tHome = useTranslations('marketing.home');

  return (
    <div aria-hidden className={'relative isolate h-[19rem] w-full'}>
      <div
        className={cn(
          uiCard,
          'absolute top-0 left-0 w-[86%] overflow-hidden sm:left-[3%] sm:w-[72%]',
        )}
      >
        <div
          className={
            'flex h-7 items-center gap-x-1.5 bg-stone-100 px-3 dark:bg-stone-800'
          }
        >
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className={'size-2 rounded-full bg-stone-300 dark:bg-stone-600'}
            />
          ))}
          <span
            className={
              'text-muted-foreground ml-2 truncate font-mono text-[0.625rem]'
            }
          >
            brightsmile.com/contact
          </span>
        </div>

        <div className={'flex flex-col gap-y-1.5 px-4 pt-3 pb-4'}>
          <FormField label={tHome('demoFieldName')} value={t('formSender')} />
          <FormField
            label={tHome('demoFieldEmail')}
            value={'alex@pixelstudio.co'}
          />
          <span className={'text-muted-foreground text-[0.6875rem]'}>
            {tHome('demoFieldMessage')}
          </span>
          <span
            className={
              'border-border bg-background h-[3.75rem] overflow-hidden rounded-lg border px-2.5 py-1.5 text-[0.75rem] leading-[1.45]'
            }
          >
            {t('formMessage')}
            <span
              className={
                'scene-caret bg-brand ml-px inline-block h-3 w-px align-[-1px]'
              }
            />
          </span>
        </div>
      </div>

      <div
        className={cn(
          uiCard,
          'lisere absolute right-0 bottom-3 flex w-[min(15rem,70%)] flex-col gap-y-2.5 p-3.5 sm:right-[3%]',
        )}
      >
        <div className={'flex items-center justify-between gap-x-2'}>
          <span className={'font-heading text-[0.9375rem] tracking-[-0.01em]'}>
            {t('formCardTitle')}
          </span>
          <Chip tone={'live'}>{t('formCardReady')}</Chip>
        </div>
        <span className={'text-muted-foreground text-[0.75rem]'}>
          {t('formCardHint')}
        </span>
        <span
          className={
            'bg-brand inline-flex h-8 items-center justify-center rounded-full text-[0.8125rem] text-white'
          }
        >
          {t('formCardSend')}
        </span>
      </div>
    </div>
  );
}

function FormField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className={'text-muted-foreground text-[0.6875rem]'}>{label}</span>
      <span
        className={
          'border-border bg-background truncate rounded-lg border px-2.5 py-1.5 text-[0.75rem]'
        }
      >
        {value}
      </span>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* E · Le pilote automatique : les envois s'empilent                         */
/* ------------------------------------------------------------------------ */

export function PilotScene() {
  const t = useTranslations('marketing.home.scenes');

  const cards = [
    {
      name: 'Harbor Plumbing Co.',
      sub: t('pilotAgo', { minutes: 12 }),
      chip: <Chip tone={'ok'}>{t('pilotSent')}</Chip>,
      tile: <Tile className={'bg-[#dceeff] dark:bg-[#1d3557]'} />,
      className: 'top-0 scale-[0.9] opacity-55',
    },
    {
      name: 'Casa Verde Ristorante',
      sub: t('pilotAsideHint'),
      chip: <Chip>{t('pilotAside')}</Chip>,
      tile: <Tile className={'bg-[#ffe1d3] dark:bg-[#4a1d0a]'} />,
      className: 'top-11 scale-[0.95] opacity-80',
    },
    {
      name: 'Bright Smile Dental',
      sub: t('pilotNow'),
      chip: <Chip tone={'live'}>{t('pilotInFlight')}</Chip>,
      tile: (
        <Tile
          className={'bg-stone-900 text-white dark:bg-white dark:text-black'}
        >
          B
        </Tile>
      ),
      className: 'scene-enter top-[5.75rem]',
    },
  ];

  return (
    <div
      aria-hidden
      className={'relative flex h-[19rem] w-full flex-col items-center'}
    >
      <div
        className={
          'bg-card border-border/80 flex items-center gap-x-2 rounded-full border px-3 py-1.5 text-[0.75rem] whitespace-nowrap'
        }
      >
        <span className={'scene-pulse size-[7px] rounded-full bg-[#2fa84f]'} />
        {t('pilotRunning')}
        <span className={'text-muted-foreground'}>
          · {t('pilotProgress', { sent: 42, target: 100 })}
        </span>
      </div>

      <div className={'relative mt-8 h-44 w-[min(20rem,92%)]'}>
        {cards.map((card) => (
          <div
            key={card.name}
            className={cn(
              uiCard,
              'absolute inset-x-0 flex items-center gap-x-3 p-3.5',
              card.className,
            )}
          >
            {card.tile}
            <div className={'flex min-w-0 flex-col'}>
              <span
                className={
                  'font-heading truncate text-[0.9375rem] leading-tight tracking-[-0.01em]'
                }
              >
                {card.name}
              </span>
              <span className={'text-muted-foreground truncate text-[0.75rem]'}>
                {card.sub}
              </span>
            </div>
            <span className={'ml-auto shrink-0'}>{card.chip}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* F · Les trois dessins au trait                                            */
/* ------------------------------------------------------------------------ */

function IridescentDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1={'0'} x2={'1'}>
        <stop offset={'0'} stopColor={'var(--iri-1)'} />
        <stop offset={'0.35'} stopColor={'var(--iri-2)'} />
        <stop offset={'0.6'} stopColor={'var(--iri-3)'} />
        <stop offset={'1'} stopColor={'var(--iri-5)'} />
      </linearGradient>
    </defs>
  );
}

const ink = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function LineArt({ kind }: { kind: 'target' | 'find' | 'contact' }) {
  const gradientId = `iri-${kind}`;

  return (
    <svg
      aria-hidden
      viewBox={'0 0 120 140'}
      className={'text-foreground h-36 w-auto'}
    >
      <IridescentDefs id={gradientId} />

      {kind === 'target' ? (
        <>
          <ellipse cx={60} cy={128} rx={34} ry={7} {...ink} />
          <path
            d={
              'M60 122 C40 92 26 74 26 54 a34 34 0 0 1 68 0 C94 74 80 92 60 122z'
            }
            {...ink}
            fill={`url(#${gradientId})`}
          />
          <circle cx={60} cy={54} r={12} {...ink} className={'fill-muted'} />
          <path d={'M102 22 l6 -6 M108 34 h8 M96 12 v-8'} {...ink} />
        </>
      ) : null}

      {kind === 'find' ? (
        <>
          <rect
            x={14}
            y={20}
            width={62}
            height={78}
            rx={6}
            {...ink}
            className={'fill-muted'}
          />
          <path d={'M24 36 h40 M24 48 h30 M24 60 h36 M24 72 h22'} {...ink} />
          <circle
            cx={72}
            cy={80}
            r={22}
            {...ink}
            fill={`url(#${gradientId})`}
          />
          <circle cx={72} cy={80} r={13} {...ink} className={'fill-muted'} />
          <path d={'M88 96 l18 18'} {...ink} strokeWidth={5} />
        </>
      ) : null}

      {kind === 'contact' ? (
        <>
          <path
            d={'M10 70 L108 26 L84 112 L58 86 Z'}
            {...ink}
            className={'fill-muted'}
          />
          <path
            d={'M58 86 L108 26 L50 112 Z'}
            {...ink}
            fill={`url(#${gradientId})`}
          />
          <path d={'M58 86 L50 112'} {...ink} />
          <path
            d={'M8 104 c10 -2 16 6 26 2 M2 120 c12 -2 18 6 30 2'}
            {...ink}
          />
        </>
      ) : null}
    </svg>
  );
}
