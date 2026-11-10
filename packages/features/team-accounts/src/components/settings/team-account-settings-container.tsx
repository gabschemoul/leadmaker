'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

import { TeamAccountDangerZone } from './team-account-danger-zone';
import { UpdateTeamAccountImage } from './update-team-account-image-container';
import { UpdateTeamAccountNameForm } from './update-team-account-name-form';

export function TeamAccountSettingsContainer(props: {
  account: {
    name: string;
    slug: string;
    id: string;
    pictureUrl: string | null;
    primaryOwnerUserId: string;
  };

  paths: {
    teamAccountSettings: string;
  };

  features: {
    enableTeamDeletion: boolean;
  };
}) {
  return (
    <div className={'flex w-full flex-col gap-8'}>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'teams.settings.teamLogo'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'teams.settings.teamLogoDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          <UpdateTeamAccountImage account={props.account} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'teams.settings.teamName'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'teams.settings.teamNameDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          <UpdateTeamAccountNameForm
            path={props.paths.teamAccountSettings}
            account={props.account}
          />
        </CardContent>
      </Card>

      <TeamAccountDangerZone
        primaryOwnerUserId={props.account.primaryOwnerUserId}
        account={props.account}
        features={props.features}
      />
    </div>
  );
}
