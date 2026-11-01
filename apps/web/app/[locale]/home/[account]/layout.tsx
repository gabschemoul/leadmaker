import { Suspense, use } from 'react';

import { cookies } from 'next/headers';

import * as z from 'zod';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { TeamAccountWorkspaceContextProvider } from '@kit/team-accounts/components';
import { Page, PageMobileNavigation, PageNavigation } from '@kit/ui/page';
import { SidebarProvider } from '@kit/ui/sidebar';

import { AppLogo } from '~/components/app-logo';
import { MobileSidebarTrigger } from '~/components/mobile-sidebar-trigger';
import { QueryHydration } from '~/components/query-hydration';
import { getTeamAccountSidebarConfig } from '~/config/team-account-navigation.config';

// local imports
import { TeamAccountLayoutMobileNavigation } from './_components/team-account-layout-mobile-navigation';
import { TeamAccountLayoutSidebar } from './_components/team-account-layout-sidebar';
import { TeamAccountNavigationMenu } from './_components/team-account-navigation-menu';
import { hasSeveralSpaces } from './_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from './_lib/server/team-account-workspace.loader';

type TeamWorkspaceLayoutProps = React.PropsWithChildren<{
  params: Promise<{ account: string }>;
}>;

/**
 * The workspace promise is passed down unawaited so the page shell and
 * `children` render immediately. Only the navigation, which reads the
 * workspace, sits behind a boundary.
 */
function TeamWorkspaceLayout({ children, params }: TeamWorkspaceLayoutProps) {
  const account = use(params).account;
  const state = use(getLayoutState(account));
  const workspace = loadTeamWorkspace(account);
  const isSidebar = state.style === 'sidebar';

  const navigation = isSidebar ? (
    // Renders its own frame and nav immediately; only its header suspends.
    <TeamAccountLayoutSidebar account={account} />
  ) : (
    <Suspense fallback={null}>
      <TeamAccountHeaderNavigation account={account} />
    </Suspense>
  );

  const content = (
    <Page style={isSidebar ? 'sidebar' : 'header'}>
      <PageNavigation>{navigation}</PageNavigation>

      <PageMobileNavigation>
        <div>
          <AppLogo />
        </div>

        {/* The sidebar already holds the nav, so mobile only needs a trigger. */}
        {isSidebar ? (
          <MobileSidebarTrigger
            collapsible={
              getTeamAccountSidebarConfig(account).sidebarCollapsedStyle
            }
          />
        ) : (
          <Suspense fallback={null}>
            <TeamAccountMobileNavigation account={account} />
          </Suspense>
        )}
      </PageMobileNavigation>

      <Suspense fallback={null}>
        <HydratedWorkspace account={account}>{children}</HydratedWorkspace>
      </Suspense>
    </Page>
  );

  return (
    <TeamAccountWorkspaceContextProvider value={workspace}>
      {isSidebar ? (
        <SidebarProvider defaultOpen={state.open}>{content}</SidebarProvider>
      ) : (
        content
      )}
    </TeamAccountWorkspaceContextProvider>
  );
}

async function HydratedWorkspace({
  account,
  children,
}: React.PropsWithChildren<{ account: string }>) {
  const data = await loadTeamWorkspace(account);

  return <QueryHydration user={data.user}>{children}</QueryHydration>;
}

async function TeamAccountHeaderNavigation({ account }: { account: string }) {
  const data = await loadTeamWorkspace(account);
  const showSpaces = await hasSeveralSpaces(
    getSupabaseServerClient(),
    data.account.id,
  );

  return <TeamAccountNavigationMenu workspace={data} showSpaces={showSpaces} />;
}

async function TeamAccountMobileNavigation({ account }: { account: string }) {
  const data = await loadTeamWorkspace(account);
  const showSpaces = await hasSeveralSpaces(
    getSupabaseServerClient(),
    data.account.id,
  );

  return (
    <TeamAccountLayoutMobileNavigation
      userId={data.user.id}
      accounts={toAccountModels(data)}
      account={account}
      showSpaces={showSpaces}
    />
  );
}

function toAccountModels(data: Awaited<ReturnType<typeof loadTeamWorkspace>>) {
  return data.accounts.map(({ name, slug, picture_url }) => ({
    label: name,
    value: slug,
    image: picture_url,
  }));
}

async function getLayoutState(account: string) {
  const cookieStore = await cookies();
  const config = getTeamAccountSidebarConfig(account);

  const LayoutStyleSchema = z
    .enum(['sidebar', 'header', 'custom'])
    .default(config.style);

  const sidebarOpenCookie = cookieStore.get('sidebar_state');
  const layoutCookie = cookieStore.get('layout-style');

  const layoutStyle = LayoutStyleSchema.safeParse(layoutCookie?.value);

  const sidebarOpenCookieValue = sidebarOpenCookie
    ? sidebarOpenCookie.value === 'true'
    : !config.sidebarCollapsed;

  const style = layoutStyle.success ? layoutStyle.data : config.style;

  return {
    open: sidebarOpenCookieValue,
    style,
  };
}

export default TeamWorkspaceLayout;
