'use client';

import { useRouter } from 'next/navigation';

import { Menu } from 'lucide-react';

import { AccountSelector } from '@kit/accounts/account-selector';
import { useSignOut } from '@kit/supabase/hooks/use-sign-out';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { Trans } from '@kit/ui/trans';

import {
  MobileNavRouteLinks,
  MobileNavSignOutItem,
} from '~/components/mobile-navigation-shared';
import featureFlagsConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';
import { getTeamAccountSidebarConfig } from '~/config/team-account-navigation.config';

type Accounts = Array<{
  label: string | null;
  value: string | null;
  image: string | null;
}>;

const features = {
  enableTeamCreation: featureFlagsConfig.enableTeamCreation,
};

export const TeamAccountLayoutMobileNavigation = (
  props: React.PropsWithChildren<{
    account: string;
    userId: string;
    accounts: Accounts;
  }>,
) => {
  const router = useRouter();
  const signOut = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Menu className={'h-9'} />
      </DropdownMenuTrigger>

      <DropdownMenuContent className={'w-screen rounded-none'}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans i18nKey={'common.yourAccounts'} />
          </DropdownMenuLabel>

          <AccountSelector
            className={'w-full max-w-full'}
            userId={props.userId}
            accounts={props.accounts}
            features={features}
            selectedAccount={props.account}
            onAccountChange={(value) => {
              if (value) {
                document.cookie = `last-selected-team=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
              }

              const path = value
                ? pathsConfig.app.accountHome.replace('[account]', value)
                : pathsConfig.app.home;

              router.replace(path);
            }}
          />
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <MobileNavRouteLinks
            routes={getTeamAccountSidebarConfig(props.account).routes}
          />
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <MobileNavSignOutItem onSignOut={() => signOut.mutateAsync()} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
