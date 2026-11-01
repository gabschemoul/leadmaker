'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';

import { PersonalAccountDropdown } from '@kit/accounts/personal-account-dropdown';
import { useSignOut } from '@kit/supabase/hooks/use-sign-out';
import { useUser } from '@kit/supabase/hooks/use-user';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { Skeleton } from '@kit/ui/skeleton';
import { Trans } from '@kit/ui/trans';

import { Delayed } from '~/components/skeletons/page-skeletons';
import featuresFlagConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';

const ModeToggle = dynamic(
  () =>
    import('@kit/ui/mode-toggle').then((mod) => ({
      default: mod.ModeToggle,
    })),
  { ssr: false },
);

const MobileModeToggle = dynamic(
  () =>
    import('@kit/ui/mobile-mode-toggle').then((mod) => ({
      default: mod.MobileModeToggle,
    })),
  { ssr: false },
);

const paths = {
  home: pathsConfig.app.home,
  profileSettings: pathsConfig.app.personalAccountSettings,
};

const features = {
  enableThemeToggle: featuresFlagConfig.enableThemeToggle,
};

/** Reads the user on the client so cacheable marketing HTML stays user-free. */
export function SiteHeaderAccountSection() {
  const signOut = useSignOut();
  const { data: user, isPending } = useUser();

  if (isPending) {
    return <AccountSectionPlaceholder />;
  }

  if (user) {
    return (
      <PersonalAccountDropdown
        showProfileName={false}
        paths={paths}
        features={features}
        user={user}
        signOutRequested={() => signOut.mutateAsync()}
      />
    );
  }

  return <AuthButtons />;
}

/** Reserves the control's space so the header doesn't shift once auth resolves. */
function AccountSectionPlaceholder() {
  return (
    <Delayed className={'flex items-center gap-x-2'}>
      <Skeleton className={'h-8 w-16'} />
      <Skeleton className={'h-8 w-20'} />
    </Delayed>
  );
}

function AuthButtons() {
  return (
    <div
      data-test={'site-header-auth-buttons'}
      className={'animate-in fade-in flex items-center gap-x-2 duration-500'}
    >
      <div className={'hidden md:flex'}>
        <If condition={features.enableThemeToggle}>
          <ModeToggle />
        </If>
      </div>

      {/* sur téléphone, le thème se change depuis le menu (manque de place) */}
      <div className={'hidden sm:flex md:hidden'}>
        <If condition={features.enableThemeToggle}>
          <MobileModeToggle />
        </If>
      </div>

      <div className={'flex items-center gap-x-2'}>
        <Button
          nativeButton={false}
          className={'hidden md:flex md:text-sm'}
          render={
            <Link href={pathsConfig.auth.signIn}>
              <Trans i18nKey={'auth.signIn'} />
            </Link>
          }
          variant={'outline'}
          size={'sm'}
        />

        <Button
          nativeButton={false}
          render={
            <Link href={pathsConfig.auth.signUp}>
              <Trans i18nKey={'auth.signUp'} />
            </Link>
          }
          className="text-xs md:text-sm"
          variant={'default'}
          size={'sm'}
        />
      </div>
    </div>
  );
}
