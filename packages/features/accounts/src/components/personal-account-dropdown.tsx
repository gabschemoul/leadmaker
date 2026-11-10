'use client';

import { useMemo } from 'react';

import Link from 'next/link';

import {
  ChevronsUpDown,
  Home,
  LogOut,
  MessageCircleQuestion,
  Shield,
  User,
} from 'lucide-react';

import { JWTUserData } from '@kit/supabase/types';
import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { If } from '@kit/ui/if';
import { SubMenuModeToggle } from '@kit/ui/mode-toggle';
import { ProfileAvatar } from '@kit/ui/profile-avatar';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { usePersonalAccountData } from '../hooks/use-personal-account-data';

export function PersonalAccountDropdown({
  className,
  user,
  signOutRequested,
  showProfileName = true,
  variant = 'default',
  paths,
  features,
  account,
}: {
  user: JWTUserData;

  account?: {
    id: string | null;
    name: string | null;
    picture_url: string | null;
  };

  signOutRequested: () => unknown;

  paths: {
    home: string;
    /** Prospectigo (10/11/2026) : page Profil ; remplace « Accueil » dans le menu du compte */
    profile?: string;
  };

  features: {
    enableThemeToggle: boolean;
  };

  showProfileName?: boolean;

  /**
   * Prospectigo (10/11/2026) : « sidebar » = ligne compacte identique au sélecteur d'équipe posé juste
   * au-dessus (même hauteur, même avatar, nom seul ; l'e-mail est dans le menu).
   */
  variant?: 'default' | 'sidebar';

  className?: string;
}) {
  const { data: personalAccountData } = usePersonalAccountData(
    user.id,
    account,
  );

  const signedInAsLabel = useMemo(() => {
    const email = user?.email ?? undefined;
    const phone = user?.phone ?? undefined;

    return email ?? phone;
  }, [user]);

  const displayName =
    personalAccountData?.name ?? account?.name ?? user?.email ?? '';

  const isSuperAdmin = useMemo(() => {
    const hasAdminRole = user?.is_superadmin;
    const isAal2 = user?.aal === 'aal2';

    return hasAdminRole && isAal2;
  }, [user]);

  const trigger =
    variant === 'sidebar' ? (
      <DropdownMenuTrigger
        aria-label="Open your profile menu"
        data-test={'account-dropdown-trigger'}
        className={cn(
          'hover:bg-sidebar-accent active:bg-sidebar-accent focus-visible:ring-ring flex h-9 w-full cursor-pointer items-center gap-x-2 rounded-lg px-2 text-left text-sm font-medium transition-colors outline-none group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 focus-visible:ring-2',
          className ?? '',
        )}
      >
        <span
          className={
            'flex aspect-square size-6 shrink-0 items-center justify-center'
          }
        >
          <Avatar className={'size-5 text-[11px]'}>
            <AvatarImage src={personalAccountData?.picture_url || undefined} />

            <AvatarFallback className={'uppercase'}>
              {(displayName || user?.email || '').slice(0, 1)}
            </AvatarFallback>
          </Avatar>
        </span>

        <span
          data-test={'account-dropdown-display-name'}
          className={
            'min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden'
          }
        >
          {displayName}
        </span>

        <ChevronsUpDown
          className={
            'text-muted-foreground ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden'
          }
        />
      </DropdownMenuTrigger>
    ) : null;

  return (
    <DropdownMenu>
      {trigger ?? (
        <DropdownMenuTrigger
          aria-label="Open your profile menu"
          data-test={'account-dropdown-trigger'}
          className={cn(
            'group/trigger fade-in focus:outline-primary flex cursor-pointer items-center group-data-[collapsible=icon]:px-0',
            className ?? '',
            {
              ['active:bg-secondary/50 group-data-[collapsible=none]:hover:bg-secondary items-center gap-4 rounded-md border-dashed p-2 transition-colors group-data-[collapsible=none]:border']:
                showProfileName,
            },
          )}
        >
          <ProfileAvatar
            className={
              'group-hover/trigger:border-background/50 border border-transparent transition-colors'
            }
            fallbackClassName={'border'}
            displayName={displayName ?? user?.email ?? ''}
            pictureUrl={personalAccountData?.picture_url}
          />

          <If condition={showProfileName}>
            <div
              className={
                'fade-in flex w-full flex-col truncate text-left group-data-[collapsible=icon]:hidden'
              }
            >
              <span
                data-test={'account-dropdown-display-name'}
                className={'truncate text-sm'}
              >
                {displayName}
              </span>

              <span
                data-test={'account-dropdown-email'}
                className={'text-muted-foreground truncate text-xs'}
              >
                {signedInAsLabel}
              </span>
            </div>

            <ChevronsUpDown
              className={
                'text-muted-foreground mr-1 h-8 group-data-[collapsible=icon]:hidden'
              }
            />
          </If>
        </DropdownMenuTrigger>
      )}

      <DropdownMenuContent className={'xl:min-w-[15rem]!'}>
        <DropdownMenuItem
          className={'group/item h-10! data-[highlighted]:bg-transparent'}
        >
          <div
            className={'flex flex-col justify-start truncate text-left text-xs'}
          >
            <div
              className={
                'text-muted-foreground group-hover/item:text-muted-foreground!'
              }
            >
              <Trans i18nKey={'common.signedInAs'} />
            </div>

            <div>
              <span className={'block truncate'}>{signedInAsLabel}</span>
            </div>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {paths.profile ? (
          <DropdownMenuItem
            render={
              <Link
                className={'flex items-center gap-x-2'}
                href={paths.profile}
                data-test={'account-dropdown-profile'}
              />
            }
          >
            <User className={'h-4 w-4'} />

            <span>
              <Trans i18nKey={'common.routes.profile'} />
            </span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            render={
              <Link className={'flex items-center gap-x-2'} href={paths.home} />
            }
          >
            <Home className={'h-4 w-4'} />

            <span>
              <Trans i18nKey={'common.routes.home'} />
            </span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={
            <Link className={'flex items-center gap-x-2'} href={'/contact'} />
          }
        >
          <MessageCircleQuestion className={'h-4 w-4'} />

          <span>
            <Trans i18nKey={'common.documentation'} />
          </span>
        </DropdownMenuItem>

        <If condition={isSuperAdmin}>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            render={
              <Link
                className={
                  'flex items-center gap-x-2 text-yellow-700 dark:text-yellow-500'
                }
                href={'/admin'}
              />
            }
          >
            <Shield className={'h-4 w-4'} />

            <span>Super Admin</span>
          </DropdownMenuItem>
        </If>

        <DropdownMenuSeparator />

        <If condition={features.enableThemeToggle}>
          <SubMenuModeToggle />
        </If>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          data-test={'account-dropdown-sign-out'}
          role={'button'}
          className={'cursor-pointer'}
          onClick={signOutRequested}
        >
          <span className={'flex w-full items-center gap-x-2'}>
            <LogOut className={'h-4 w-4'} />

            <span>
              <Trans i18nKey={'auth.signOut'} />
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
