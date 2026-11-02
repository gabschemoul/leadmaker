'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { LayoutDashboard, Users } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
} from '@kit/ui/sidebar';

import { AppLogo } from '~/components/app-logo';
import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';

export function AdminSidebar() {
  const path = usePathname();

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className={'m-2'}>
        <AppLogo href={'/admin'} className="max-w-full" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Super Admin</SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuButton
                isActive={path === '/admin'}
                render={<Link className={'flex gap-2.5'} href={'/admin'} />}
              >
                <LayoutDashboard className={'h-4'} />
                <span>Dashboard</span>
              </SidebarMenuButton>

              <SidebarMenuButton
                isActive={path.includes('/admin/accounts')}
                render={
                  <Link
                    className={'flex size-full gap-2.5'}
                    href={'/admin/accounts'}
                  >
                    <Users className={'h-4'} />
                    <span>Accounts</span>
                  </Link>
                }
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <ProfileAccountDropdownContainer />
      </SidebarFooter>
    </Sidebar>
  );
}
