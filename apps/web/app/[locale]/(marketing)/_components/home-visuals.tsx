import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@kit/ui/utils';

/**
 * Petits visuels de démonstration de la page d'accueil (équivalent maison des
 * « orbes » d'ElevenLabs) : une carte avec des épingles, la liste des
 * entreprises trouvées, un formulaire rempli. Purement illustratifs.
 */

/** Halo coloré flou derrière les visuels : la seule touche de couleur. */
export function Aura({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute size-72 rounded-full opacity-50 blur-3xl dark:opacity-30',
        className,
      )}
      style={{
        background:
          'radial-gradient(circle at 30% 30%, #ff8a4c 0%, #ff4704 35%, #2b7fff 75%, transparent 100%)',
      }}
    />
  );
}

const pins = [
  { x: 22, y: 30, on: true },
  { x: 35, y: 58, on: true },
  { x: 48, y: 22, on: false },
  { x: 57, y: 47, on: true },
  { x: 66, y: 70, on: true },
  { x: 74, y: 33, on: false },
  { x: 82, y: 55, on: true },
  { x: 28, y: 76, on: true },
  { x: 44, y: 82, on: false },
];

export function MapVisual({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('marketing.home');

  return (
    <div className={'relative h-full w-full'}>
      <svg
        aria-hidden
        className={
          'absolute inset-0 h-full w-full text-stone-300 dark:text-stone-700'
        }
        viewBox={'0 0 600 360'}
        preserveAspectRatio={'xMidYMid slice'}
      >
        <g fill={'none'} stroke={'currentColor'} strokeWidth={1}>
          <path d="M430 20c110 0 190 70 190 160s-80 170-190 170-165-70-165-160 55-170 165-170z" />
          <path d="M435 75c75 0 130 48 130 110s-55 118-130 118-115-48-115-108 40-120 115-120z" />
          <path d="M440 130c38 0 66 24 66 56s-28 60-66 60-58-24-58-54 20-62 58-62z" />
          <path d="M150 -20c110 0 180 60 180 140s-70 150-180 150S-20 210-20 130 40-20 150-20z" />
          <path d="M152 40c65 0 110 38 110 88s-45 92-110 92-100-38-100-86 35-94 100-94z" />
          <path d="M-20 320c160-60 300-20 460 20s260 30 200-20" />
          <path
            d="M-20 350c160-60 300-20 460 20s260 30 200-20"
            strokeDasharray={'3 4'}
          />
        </g>
      </svg>

      {pins.map((pin, index) => (
        <span
          key={index}
          className={cn(
            'absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-stone-900',
            pin.on
              ? 'bg-foreground size-3'
              : 'size-2.5 bg-stone-300 dark:bg-stone-600',
          )}
          style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
        />
      ))}

      {!compact ? (
        <div
          className={
            'bg-card shadow-float ring-pill-ring absolute top-1/2 left-1/2 flex w-[min(20rem,85%)] -translate-x-1/2 -translate-y-1/2 flex-col gap-y-1 rounded-xl px-4 py-3 ring-[0.5px]'
          }
        >
          <span className={'text-[0.9375rem]'}>{t('demoSearch')}</span>
          <span className={'text-muted-foreground text-[0.8125rem]'}>
            {t('demoFound')}
          </span>
        </div>
      ) : null}
    </div>
  );
}

const businesses = [
  { name: 'Plomberie Martin', rating: 4.8, reviews: 132, status: 'form' },
  { name: 'Atelier Durand', rating: 4.6, reviews: 87, status: 'form' },
  { name: 'Lefèvre & Fils', rating: 4.9, reviews: 214, status: 'email' },
  { name: 'Eau Services', rating: 3.9, reviews: 41, status: 'none' },
] as const;

export function ListVisual() {
  const t = useTranslations('marketing.home');
  const format = useFormatter();

  return (
    <div
      className={
        'bg-card shadow-float ring-pill-ring w-[min(24rem,92%)] overflow-hidden rounded-xl ring-[0.5px]'
      }
    >
      {businesses.map((business) => (
        <div
          key={business.name}
          className={cn(
            'border-border/70 flex items-center justify-between gap-x-3 border-b px-4 py-3 last:border-b-0',
            business.status === 'none' && 'opacity-45',
          )}
        >
          <div className={'flex min-w-0 flex-col'}>
            <span className={'truncate text-[0.875rem] font-medium'}>
              {business.name}
            </span>
            <span className={'text-muted-foreground text-[0.75rem]'}>
              {format.number(business.rating, { minimumFractionDigits: 1 })} ★ ·{' '}
              {t('demoReviews', { count: business.reviews })}
            </span>
          </div>

          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[0.75rem]',
              business.status === 'none'
                ? 'text-muted-foreground'
                : 'bg-muted text-foreground',
            )}
          >
            {business.status === 'form'
              ? t('demoFormFound')
              : business.status === 'email'
                ? t('demoEmailFound')
                : t('demoNoSite')}
          </span>
        </div>
      ))}
    </div>
  );
}

export function FormVisual() {
  const t = useTranslations('marketing.home');

  return (
    <div
      className={
        'bg-card shadow-float ring-pill-ring flex w-[min(24rem,92%)] flex-col gap-y-3 rounded-xl p-4 ring-[0.5px]'
      }
    >
      <Field label={t('demoFieldName')} value={'Camille Roux'} />
      <Field label={t('demoFieldEmail')} value={'camille@agence-roux.com'} />

      <div className={'flex flex-col gap-y-1'}>
        <span className={'text-muted-foreground text-[0.75rem]'}>
          {t('demoFieldMessage')}
        </span>
        <span
          className={
            'border-border rounded-lg border px-3 py-2 text-[0.8125rem] leading-[1.45]'
          }
        >
          {t('demoMessage')}
        </span>
      </div>

      <div className={'flex items-center justify-between pt-1'}>
        <span className={'flex items-center gap-x-1.5 text-[0.8125rem]'}>
          <span className={'size-1.5 rounded-full bg-[#1f9d55]'} />
          {t('demoSent')}
        </span>
        <span
          className={
            'bg-primary text-primary-foreground inline-flex h-7 items-center rounded-full px-3 text-[0.75rem]'
          }
        >
          {t('demoScreenshot')}
        </span>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={'flex flex-col gap-y-1'}>
      <span className={'text-muted-foreground text-[0.75rem]'}>{label}</span>
      <span
        className={
          'border-border rounded-lg border px-3 py-1.5 text-[0.8125rem]'
        }
      >
        {value}
      </span>
    </div>
  );
}
