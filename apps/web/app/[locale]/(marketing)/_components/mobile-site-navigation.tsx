'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

import Link from 'next/link';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useUser } from '@kit/supabase/hooks/use-user';
import { Button } from '@kit/ui/button';
import { MobileModeToggle } from '@kit/ui/mobile-mode-toggle';
import { cn } from '@kit/ui/utils';

import pathsConfig from '~/config/paths.config';

import { pillButtonClasses } from './el';

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
  // Connecté : un seul bouton vers l'espace, à la place de « Se connecter »
  // et « S'inscrire » (la photo est déjà affichée dans l'en-tête).
  const { data: user, isPending } = useUser();
  const actions = isPending
    ? []
    : user
      ? [
          {
            path: pathsConfig.app.home,
            label: 'marketing.openApp',
            variant: 'default' as const,
          },
        ]
      : links.filter((item) => item.variant);

  return (
    <>
      <button
        type={'button'}
        data-test={'mobile-menu-button'}
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={
          'hover:bg-muted relative -mr-2 flex size-9 items-center justify-center rounded-full transition-colors'
        }
      >
        <span
          className={cn(
            'bg-foreground absolute h-[1.5px] w-4 rounded-full transition-transform duration-300 ease-out',
            open ? 'rotate-45' : '-translate-y-[4px]',
          )}
        />
        <span
          className={cn(
            'bg-foreground absolute h-[1.5px] w-4 rounded-full transition-transform duration-300 ease-out',
            open ? '-rotate-45' : 'translate-y-[4px]',
          )}
        />
      </button>

      {open
        ? createPortal(
            <div
              data-test={'mobile-menu'}
              className={
                'bg-background animate-in fade-in slide-in-from-top-2 fixed inset-x-0 top-16 bottom-0 z-50 flex flex-col overflow-y-auto px-6 pt-6 pb-10 duration-200 md:hidden'
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
                      'border-border/60 font-heading flex items-center justify-between border-b py-4 text-[1.75rem] font-light tracking-[-0.02em]'
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
                <MobileModeToggle
                  className={'hover:bg-muted size-10 rounded-lg border'}
                />
              </div>

              <div className={'mt-auto flex flex-col gap-3 pt-8'}>
                {actions.map((item) => (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setOpen(false)}
                    className={pillButtonClasses({
                      variant:
                        item.variant === 'default' ? 'primary' : 'secondary',
                      size: 'lg',
                      className: 'w-full',
                    })}
                  >
                    {t(item.label)}
                  </Link>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
