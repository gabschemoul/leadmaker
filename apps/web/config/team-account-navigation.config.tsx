import {
  CreditCard,
  FolderKanban,
  Settings,
  UserSearch,
  Users,
} from 'lucide-react';

import { NavigationConfigSchema } from '@kit/ui/navigation-schema';

import { CampaignsIcon } from '~/components/icons/campaigns-icon';
import { FormsIcon } from '~/components/icons/forms-icon';
import { SendersIcon } from '~/components/icons/senders-icon';
import featureFlagsConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';

// Icônes au gabarit d'ElevenLabs : 20 px (10/11/2026, un peu plus grandes qu'avant), trait de 1,5 px à
// l'écran pour toutes. « ! » : le bouton de menu impose 16 px à ses icônes ([&_svg]:size-4).
// Lucide est dessiné sur 24 : 1,8 × 20/24 = 1,5 px. Nos icônes sur 18 : 1,35 × 20/18 = 1,5 px.
// barre repliée : le bouton ne laisse que 16 px, l'icône déborde de 2 px sur la marge intérieure
const iconClasses = 'size-5! group-data-[collapsible=icon]:-m-0.5';
const iconProps = { className: iconClasses, strokeWidth: 1.8 } as const;
const customIconProps = { className: iconClasses, strokeWidth: 1.35 } as const;

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
        label: 'common.routes.campaigns',
        path: createPath(pathsConfig.app.accountCampaigns, account),
        Icon: <CampaignsIcon {...customIconProps} />,
      },
      {
        label: 'common.routes.forms',
        path: createPath(pathsConfig.app.accountForms, account),
        Icon: <FormsIcon {...customIconProps} />,
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
        Icon: <SendersIcon {...customIconProps} />,
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
