import {
  Contact,
  CreditCard,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Radar,
  Settings,
  UserSearch,
  Users,
} from 'lucide-react';

import { NavigationConfigSchema } from '@kit/ui/navigation-schema';

import featureFlagsConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';

const iconClasses = 'w-4';

/**
 * `showSpaces` : l'entrée « Dossiers clients » n'apparaît que quand
 * l'organisation en a plusieurs (une PME qui prospecte pour elle-même n'en
 * a pas besoin). Par défaut cachée, le temps de charger le nombre de dossiers.
 */
const getRoutes = (account: string, showSpaces: boolean) => [
  {
    label: 'common.routes.application',
    children: [
      {
        label: 'common.routes.dashboard',
        path: pathsConfig.app.accountHome.replace('[account]', account),
        Icon: <LayoutDashboard className={iconClasses} />,
        highlightMatch: `${pathsConfig.app.home}$`,
      },
      {
        label: 'common.routes.campaigns',
        path: createPath(pathsConfig.app.accountCampaigns, account),
        Icon: <Radar className={iconClasses} />,
      },
      {
        label: 'common.routes.forms',
        path: createPath(pathsConfig.app.accountForms, account),
        Icon: <Inbox className={iconClasses} />,
      },
      {
        label: 'common.routes.prospects',
        path: createPath(pathsConfig.app.accountProspects, account),
        Icon: <UserSearch className={iconClasses} />,
      },
    ],
  },
  {
    label: 'common.routes.settings',
    collapsible: false,
    children: [
      {
        label: 'common.routes.sender',
        path: createPath(pathsConfig.app.accountSender, account),
        Icon: <Contact className={iconClasses} />,
      },
      {
        label: 'common.routes.members',
        path: createPath(pathsConfig.app.accountMembers, account),
        Icon: <Users className={iconClasses} />,
      },
      showSpaces
        ? {
            label: 'common.routes.spaces',
            path: createPath(pathsConfig.app.accountSpaces, account),
            Icon: <FolderKanban className={iconClasses} />,
          }
        : undefined,
      featureFlagsConfig.enableTeamAccountBilling
        ? {
            label: 'common.routes.billing',
            path: createPath(pathsConfig.app.accountBilling, account),
            Icon: <CreditCard className={iconClasses} />,
          }
        : undefined,
      {
        label: 'common.routes.settings',
        path: createPath(pathsConfig.app.accountSettings, account),
        Icon: <Settings className={iconClasses} />,
      },
    ].filter(Boolean),
  },
];

export function getTeamAccountSidebarConfig(
  account: string,
  options: { showSpaces?: boolean } = {},
) {
  return NavigationConfigSchema.parse({
    routes: getRoutes(account, options.showSpaces ?? false),
    style: process.env.NEXT_PUBLIC_TEAM_NAVIGATION_STYLE,
    sidebarCollapsed: process.env.NEXT_PUBLIC_TEAM_SIDEBAR_COLLAPSED,
    sidebarCollapsedStyle: process.env.NEXT_PUBLIC_SIDEBAR_COLLAPSIBLE_STYLE,
  });
}

function createPath(path: string, account: string) {
  return path.replace('[account]', account);
}
