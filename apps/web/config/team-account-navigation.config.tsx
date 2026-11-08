import {
  Contact,
  CreditCard,
  FolderKanban,
  House,
  Inbox,
  Radar,
  Settings,
  UserSearch,
  Users,
} from 'lucide-react';

import { NavigationConfigSchema } from '@kit/ui/navigation-schema';

import featureFlagsConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';

// icônes au gabarit d'ElevenLabs (8/11/2026) : 18 px, trait 1,5 px, bouts arrondis
const iconClasses = 'size-[18px]';
const iconProps = { className: iconClasses, strokeWidth: 1.5 } as const;

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
        Icon: <House {...iconProps} />,
        highlightMatch: `${pathsConfig.app.home}$`,
      },
      {
        label: 'common.routes.campaigns',
        path: createPath(pathsConfig.app.accountCampaigns, account),
        Icon: <Radar {...iconProps} />,
      },
      {
        label: 'common.routes.forms',
        path: createPath(pathsConfig.app.accountForms, account),
        Icon: <Inbox {...iconProps} />,
      },
      {
        label: 'common.routes.prospects',
        path: createPath(pathsConfig.app.accountProspects, account),
        Icon: <UserSearch {...iconProps} />,
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
        Icon: <Contact {...iconProps} />,
      },
      {
        label: 'common.routes.members',
        path: createPath(pathsConfig.app.accountMembers, account),
        Icon: <Users {...iconProps} />,
      },
      showSpaces
        ? {
            label: 'common.routes.spaces',
            path: createPath(pathsConfig.app.accountSpaces, account),
            Icon: <FolderKanban {...iconProps} />,
          }
        : undefined,
      featureFlagsConfig.enableTeamAccountBilling
        ? {
            label: 'common.routes.billing',
            path: createPath(pathsConfig.app.accountBilling, account),
            Icon: <CreditCard {...iconProps} />,
          }
        : undefined,
      {
        label: 'common.routes.settings',
        path: createPath(pathsConfig.app.accountSettings, account),
        Icon: <Settings {...iconProps} />,
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
