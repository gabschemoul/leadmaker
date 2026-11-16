import {
  BorderedNavigationMenu,
  BorderedNavigationMenuItem,
} from '@kit/ui/bordered-navigation-menu';
import { If } from '@kit/ui/if';

import { AppLogo } from '~/components/app-logo';
import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';
import featureFlagsConfig from '~/config/feature-flags.config';
import { getTeamAccountSidebarConfig } from '~/config/team-account-navigation.config';
import { TeamAccountAccountsSelector } from '~/home/[account]/_components/team-account-accounts-selector';

// local imports
import { TeamAccountWorkspace } from '../_lib/server/team-account-workspace.loader';
import { TeamAccountNotifications } from './team-account-notifications';

export function TeamAccountNavigationMenu(props: {
  workspace: TeamAccountWorkspace;
}) {
  const { account, user, accounts } = props.workspace;

  const routes = getTeamAccountSidebarConfig(account.slug).routes.reduce<
    Array<{
      path: string;
      label: string;
      Icon?: React.ReactNode;
      end?: boolean | ((path: string) => boolean);
    }>
  >((acc, item) => {
    if ('children' in item) {
      return [...acc, ...item.children];
    }

    if ('divider' in item) {
      return acc;
    }

    return [...acc, item];
  }, []);

  return (
    <div className={'flex w-full flex-1 justify-between'}>
      <div className={'flex items-center space-x-8'}>
        <div>
          <AppLogo />
        </div>

        <BorderedNavigationMenu>
          {routes.map((route) => (
            <BorderedNavigationMenuItem {...route} key={route.path} />
          ))}
        </BorderedNavigationMenu>
      </div>

      <div className={'flex items-center justify-end space-x-1'}>
        <If condition={featureFlagsConfig.enableNotifications}>
          <TeamAccountNotifications accountId={account.id} userId={user.id} />
        </If>

        <div>
          <TeamAccountAccountsSelector
            userId={user.id}
            selectedAccount={account.slug}
            accounts={accounts.map((account) => ({
              label: account.name,
              value: account.slug,
              image: account.picture_url,
            }))}
          />
        </div>

        <div>
          <ProfileAccountDropdownContainer
            user={user}
            showProfileName={false}
            accountSlug={account.slug}
          />
        </div>
      </div>
    </div>
  );
}
