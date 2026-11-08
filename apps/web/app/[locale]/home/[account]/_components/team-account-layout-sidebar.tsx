import { Suspense } from 'react';

import Link from 'next/link';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@kit/ui/sidebar';

import { LogoImage } from '~/components/app-logo';
import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';
import { SidebarHeaderSkeleton } from '~/components/skeletons/page-skeletons';
import { WorkspaceDropdown } from '~/components/workspace-dropdown';
import pathsConfig from '~/config/paths.config';
import { getTeamAccountSidebarConfig } from '~/config/team-account-navigation.config';

import { hasSeveralSpaces } from '../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { TeamAccountLayoutSidebarNavigation } from './team-account-layout-sidebar-navigation';

/**
 * Barre latérale façon ElevenLabs (relooking du 8/11/2026) : logo en haut à
 * gauche, sélecteur d'équipe juste dessous, navigation par groupes, et en bas
 * la ligne du compte (avatar, nom, menu). Le cadre et la navigation viennent de
 * la configuration et s'affichent tout de suite ; seuls le sélecteur et la
 * ligne du compte attendent l'espace de travail.
 */
export function TeamAccountLayoutSidebar({ account }: { account: string }) {
  const config = getTeamAccountSidebarConfig(account);
  const homePath = pathsConfig.app.accountHome.replace('[account]', account);

  return (
    <Sidebar variant="sidebar" collapsible={config.sidebarCollapsedStyle}>
      <SidebarHeader className={'gap-3 px-3 pt-3.5 pb-1'}>
        <Link
          href={homePath}
          aria-label={'Prospectigo'}
          className={
            'flex h-7 items-center px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0'
          }
        >
          <LogoImage className={'text-[1.25rem]'} />
        </Link>

        <Suspense fallback={<SidebarHeaderSkeleton />}>
          <TeamAccountSidebarHeader account={account} />
        </Suspense>
      </SidebarHeader>

      <SidebarContent className={'px-1 pt-2'}>
        <Suspense
          fallback={<TeamAccountLayoutSidebarNavigation config={config} />}
        >
          <TeamAccountSidebarNavigation account={account} />
        </Suspense>
      </SidebarContent>

      <SidebarFooter
        className={
          'border-t px-2 py-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0'
        }
      >
        <Suspense fallback={<SidebarHeaderSkeleton />}>
          <TeamAccountSidebarUser account={account} />
        </Suspense>
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
    <WorkspaceDropdown
      user={data.user}
      accounts={accounts}
      selectedAccount={account}
    />
  );
}

async function TeamAccountSidebarUser({ account }: { account: string }) {
  const data = await loadTeamWorkspace(account);

  return (
    <ProfileAccountDropdownContainer
      user={data.user}
      accountSlug={account}
      showProfileName
    />
  );
}
