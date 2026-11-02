import { Suspense } from 'react';

import { If } from '@kit/ui/if';
import { Sidebar, SidebarContent, SidebarHeader } from '@kit/ui/sidebar';
import { SidebarNavigation } from '@kit/ui/sidebar-navigation';

import { SidebarHeaderSkeleton } from '~/components/skeletons/page-skeletons';
import { WorkspaceDropdown } from '~/components/workspace-dropdown';
import featuresFlagConfig from '~/config/feature-flags.config';
import { personalAccountNavigationConfig } from '~/config/personal-account-navigation.config';
import { UserNotifications } from '~/home/(user)/_components/user-notifications';

// home imports
import { loadUserWorkspace } from '../_lib/server/load-user-workspace';

/**
 * Frame and navigation come from config, so they render immediately and the
 * sidebar never shifts. Only the header widget waits on the workspace.
 */
export function HomeSidebar() {
  return (
    <Sidebar
      variant="sidebar"
      collapsible={personalAccountNavigationConfig.sidebarCollapsedStyle}
    >
      <SidebarHeader className={'h-16 justify-center'}>
        <Suspense fallback={<SidebarHeaderSkeleton />}>
          <HomeSidebarHeader />
        </Suspense>
      </SidebarHeader>

      <SidebarContent>
        <SidebarNavigation config={personalAccountNavigationConfig} />
      </SidebarContent>
    </Sidebar>
  );
}

async function HomeSidebarHeader() {
  const { workspace, user, accounts } = await loadUserWorkspace();

  return (
    <div className={'flex items-center justify-between gap-x-1'}>
      <WorkspaceDropdown
        user={user}
        accounts={accounts}
        workspace={workspace}
      />

      <If condition={featuresFlagConfig.enableNotifications}>
        <div className={'group-data-[collapsible=icon]:hidden'}>
          <UserNotifications userId={user.id} />
        </div>
      </If>
    </div>
  );
}
