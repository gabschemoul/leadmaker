'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import { cn } from '@kit/ui/utils';

import { Aura, FormVisual, ListVisual, MapVisual } from './home-visuals';

const tabs = [
  { id: 'target', dot: 'bg-[#ff4704]', step: 'step1' },
  { id: 'find', dot: 'bg-[#2b7fff]', step: 'step2' },
  { id: 'contact', dot: 'bg-stone-400', step: 'step3' },
] as const;

/**
 * Grand cadre gris sous le héros, avec onglets segmentés : l'équivalent de la
 * démo « orbes » d'ElevenLabs, appliqué aux trois étapes de Prospectigo.
 */
export function HomeDemo() {
  const t = useTranslations('marketing.home');
  const [active, setActive] = useState<(typeof tabs)[number]['id']>('target');

  const current = tabs.find((tab) => tab.id === active)!;

  return (
    <div
      className={'bg-muted overflow-hidden rounded-2xl p-1'}
      data-test={'home-demo'}
    >
      <div role={'tablist'} className={'grid grid-cols-3 gap-1'}>
        {tabs.map((tab, index) => {
          const selected = tab.id === active;

          return (
            <button
              key={tab.id}
              type={'button'}
              role={'tab'}
              aria-selected={selected}
              onClick={() => setActive(tab.id)}
              className={cn(
                'flex h-10 items-center justify-center gap-x-2 rounded-xl text-[0.9375rem] tracking-[0.01em] transition-[background-color,color,box-shadow] duration-150 outline-none',
                'focus-visible:outline-focus focus-visible:outline-[1.5px] focus-visible:outline-solid',
                selected
                  ? 'bg-card text-foreground shadow-soft ring-pill-ring ring-[0.5px]'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('size-2 rounded-full', tab.dot)} />
              {t(`demoTab${index + 1}`)}
            </button>
          );
        })}
      </div>

      <div
        className={
          'relative flex h-[22rem] items-center justify-center overflow-hidden sm:h-[26rem]'
        }
      >
        {active === 'target' ? (
          <>
            <Aura className={'top-6 left-[12%]'} />
            <MapVisual />
          </>
        ) : null}

        {active === 'find' ? (
          <>
            <Aura className={'right-[10%] bottom-0'} />
            <ListVisual />
          </>
        ) : null}

        {active === 'contact' ? (
          <>
            <Aura className={'top-4 right-[18%]'} />
            <FormVisual />
          </>
        ) : null}
      </div>

      <div
        className={'flex flex-col items-center gap-y-1 px-6 pb-8 text-center'}
      >
        <span className={'text-[0.9375rem]'}>{t(`${current.step}Label`)}</span>
        <span
          className={
            'text-muted-foreground max-w-xl text-[0.8125rem] leading-[1.45] text-pretty'
          }
        >
          {t(current.step)}
        </span>
      </div>
    </div>
  );
}
