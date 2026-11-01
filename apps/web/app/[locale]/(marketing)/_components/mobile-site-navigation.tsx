'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

import Link from 'next/link';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@kit/ui/button';
import { MobileModeToggle } from '@kit/ui/mobile-mode-toggle';
import { cn } from '@kit/ui/utils';

/**
 * Menu mobile du site : bouton à deux traits qui se change en croix, et
 * panneau plein écran sous l'en-tête. Le panneau passe par un portail :
 * l'en-tête a un flou d'arrière-plan, qui piégerait un élément `fixed`.
 */
export function MobileSiteNavigation({
  links,
}: {
  links: {
    path: string;
    label: string;
    variant?: React.ComponentProps<typeof Button>['variant'];
  }[];
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  const pages = links.filter((item) => !item.variant);
  const actions = links.filter((item) => item.variant);

  return (
    <>
      <button
        type={'button'}
        data-test={'mobile-menu-button'}
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={
          'hover:bg-muted relative flex size-10 items-center justify-center rounded-full transition-colors'
        }
      >
        <span
          className={cn(
            'bg-foreground absolute h-[2px] w-5 rounded-full transition-transform duration-300 ease-out',
            open ? 'rotate-45' : '-translate-y-[4px]',
          )}
        />
        <span
          className={cn(
            'bg-foreground absolute h-[2px] w-5 rounded-full transition-transform duration-300 ease-out',
            open ? '-rotate-45' : 'translate-y-[4px]',
          )}
        />
      </button>

      {open
        ? createPortal(
            <div
              data-test={'mobile-menu'}
              className={
                'bg-background animate-in fade-in slide-in-from-top-2 fixed inset-x-0 top-14 bottom-0 z-50 flex flex-col overflow-y-auto px-6 pt-6 pb-10 duration-200 md:hidden'
              }
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                }
              }}
            >
              <nav className={'flex flex-col'}>
                {pages.map((item) => (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setOpen(false)}
                    className={
                      'border-border/60 flex items-center justify-between border-b py-4 text-2xl font-medium tracking-tight'
                    }
                  >
                    {t(item.label)}
                    <ArrowRight className={'text-muted-foreground size-5'} />
                  </Link>
                ))}
              </nav>

              <div
                className={
                  'text-muted-foreground flex items-center justify-between py-4 text-sm sm:hidden'
                }
              >
                {t('marketing.theme')}
                <MobileModeToggle className={'size-10 border'} />
              </div>

              <div className={'mt-auto flex flex-col gap-3 pt-8'}>
                {actions.map((item) => (
                  <Button
                    key={item.path}
                    size={'lg'}
                    variant={item.variant}
                    className={'h-12 w-full text-base'}
                    nativeButton={false}
                    onClick={() => setOpen(false)}
                    render={<Link href={item.path}>{t(item.label)}</Link>}
                  />
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
