'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NavigationMenuItem } from '@kit/ui/navigation-menu';
import { cn, isRouteActive } from '@kit/ui/utils';

const getClassName = (isActive: boolean) =>
  cn(
    `hover:bg-muted inline-flex h-8 w-max items-center rounded-full px-3 text-[0.9375rem] tracking-[0.01em] transition-colors duration-150`,
    {
      'text-foreground': !isActive,
      'bg-muted text-foreground': isActive,
    },
  );

export function SiteNavigationItem({
  path,
  children,
}: React.PropsWithChildren<{
  path: string;
}>) {
  const currentPathName = usePathname();

  return (
    <SiteNavigationLink
      path={path}
      isActive={isRouteActive(path, currentPathName)}
    >
      {children}
    </SiteNavigationLink>
  );
}

/**
 * The link itself needs no URL data, so it renders in the shell. Only the
 * active highlight waits on `usePathname`.
 */
export function SiteNavigationLink({
  path,
  isActive = false,
  children,
}: React.PropsWithChildren<{
  path: string;
  isActive?: boolean;
}>) {
  return (
    <NavigationMenuItem key={path}>
      <Link className={getClassName(isActive)} href={path} as={path}>
        {children}
      </Link>
    </NavigationMenuItem>
  );
}
