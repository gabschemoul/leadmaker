import { Suspense } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { If } from '@kit/ui/if';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@kit/ui/sidebar';

import { LogoImage } from '~/components/app-logo';
import { SidebarHeaderSkeleton } from '~/components/skeletons/page-skeletons';
import { WorkspaceDropdown } from '~/components/workspace-dropdown';
import featureFlagsConfig from '~/config/feature-flags.config';
import { getTeamAccountSidebarConfig } from '~/config/team-account-navigation.config';
import { TeamAccountNotifications } from '~/home/[account]/_components/team-account-notifications';

import { hasSeveralSpaces } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { TeamAccountLayoutSidebarNavigation } from './team-account-layout-sidebar-navigation';

/**
 * Frame and navigation come from config, so they render immediately and the
 * sidebar never shifts. Only the header widget waits on the workspace, and
 * the « Dossiers clients » entry waits on the number of folders (the
 * fallback is the same navigation without it).
 */
export function TeamAccountLayoutSidebar({ account }: { account: string }) {
  const config = getTeamAccountSidebarConfig(account);

  return (
    <Sidebar variant="sidebar" collapsible={config.sidebarCollapsedStyle}>
      <SidebarHeader className={'h-16 justify-center'}>
        <Suspense fallback={<SidebarHeaderSkeleton />}>
          <TeamAccountSidebarHeader account={account} />
        </Suspense>
      </SidebarHeader>

      <SidebarContent className="h-[calc(100%-160px)] overflow-y-auto">
        <Suspense
          fallback={<TeamAccountLayoutSidebarNavigation config={config} />}
        >
          <TeamAccountSidebarNavigation account={account} />
        </Suspense>
      </SidebarContent>
      <SidebarFooter
        className={
          'mt-auto px-4 pt-3 pb-5 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0'
        }
      >
        <LogoImage className={'text-lg'} />
      </SidebarFooter>
    </Sidebar>
  );
}

async function TeamAccountSidebarNavigation({ account }: { account: string }) {
  const data = await loadTeamWorkspace(account);
  const client = getSupabaseServerClient();
  const showSpaces = await hasSeveralSpaces(client, data.account.id);

  return (
    <TeamAccountLayoutSidebarNavigation
      config={getTeamAccountSidebarConfig(account, { showSpaces })}
    />
  );
}

async function TeamAccountSidebarHeader({ account }: { account: string }) {
  const data = await loadTeamWorkspace(account);

  const accounts = data.accounts.map(({ name, slug, picture_url }) => ({
    label: name,
    value: slug,
    image: picture_url,
  }));

  return (
    <div className={'flex items-center justify-between gap-x-1'}>
      <WorkspaceDropdown
        user={data.user}
        accounts={accounts}
        selectedAccount={account}
      />

      <If condition={featureFlagsConfig.enableNotifications}>
        <div className={'group-data-[collapsible=icon]:hidden'}>
          <TeamAccountNotifications
            userId={data.user.id}
            accountId={data.account.id}
          />
        </div>
      </If>
    </div>
  );
}
