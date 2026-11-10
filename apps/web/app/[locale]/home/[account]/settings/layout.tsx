import { Suspense } from 'react';

import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import featuresFlagConfig from '~/config/feature-flags.config';

import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { SettingsSubNavigation } from './_components/settings-sub-navigation';

interface SettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ account: string }>;
}

/**
 * Titre et onglets affichés tout de suite (10/11/2026) : seuls les liens des onglets attendent l'adresse de
 * l'organisation, avec les mêmes libellés à leur place en attendant.
 */
function SettingsLayout({ children, params }: SettingsLayoutProps) {
  return (
    <PageBody>
      <div>
        <TeamAccountLayoutPageHeader
          title={<Trans i18nKey={'teams.settings.pageTitle'} />}
        />

        {featuresFlagConfig.enableTeamsOnly && (
          <div className="mb-8">
            <Suspense fallback={<SettingsTabsPlaceholder />}>
              <SettingsTabs params={params} />
            </Suspense>
          </div>
        )}
      </div>

      {children}
    </PageBody>
  );
}

export default SettingsLayout;

async function SettingsTabs({
  params,
}: {
  params: SettingsLayoutProps['params'];
}) {
  const { account } = await params;

  return <SettingsSubNavigation account={account} />;
}

/** Mêmes libellés et même place que les onglets, sans liens. */
function SettingsTabsPlaceholder() {
  return (
    <div className={'flex h-9 items-center gap-2'}>
      {['common.routes.settings', 'common.routes.profile'].map((key) => (
        <span
          key={key}
          className={'text-secondary-foreground/80 px-3 text-sm font-medium'}
        >
          <Trans i18nKey={key} />
        </span>
      ))}
    </div>
  );
}
