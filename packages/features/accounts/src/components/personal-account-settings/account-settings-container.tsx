'use client';

import type { Provider } from '@supabase/supabase-js';

import { routing } from '@kit/i18n';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { LanguageSelector } from '@kit/ui/language-selector';
import { LoadingOverlay } from '@kit/ui/loading-overlay';
import { Trans } from '@kit/ui/trans';

import { usePersonalAccountData } from '../../hooks/use-personal-account-data';
import { AccountDangerZone } from './account-danger-zone';
import { UpdateEmailFormContainer } from './email/update-email-form-container';
import { LinkAccountsList } from './link-accounts';
import { MultiFactorAuthFactorsList } from './mfa/multi-factor-auth-list';
import { PasskeysList } from './passkeys/passkeys-list';
import { UpdatePasswordFormContainer } from './password/update-password-container';
import { UpdateAccountDetailsFormContainer } from './update-account-details-form-container';
import { UpdateAccountImageContainer } from './update-account-image-container';

export function PersonalAccountSettingsContainer(
  props: React.PropsWithChildren<{
    userId: string;

    features: {
      enableAccountDeletion: boolean;
      enablePasswordUpdate: boolean;
      enableAccountLinking: boolean;
      enablePasskeys: boolean;
      showLinkEmailOption: boolean;
    };

    paths: {
      callback: string;
    };

    providers: Provider[];
  }>,
) {
  const supportsLanguageSelection = useSupportMultiLanguage();
  const user = usePersonalAccountData(props.userId);

  if (!user.data || user.isPending) {
    return <LoadingOverlay fullPage />;
  }

  return (
    <div className={'flex w-full flex-col gap-8 pb-32'}>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'account.accountImage'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'account.accountImageDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          <UpdateAccountImageContainer
            user={{
              pictureUrl: user.data.picture_url,
              id: user.data.id,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'account.name'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'account.nameDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          <UpdateAccountDetailsFormContainer user={user.data} />
        </CardContent>
      </Card>

      <If condition={supportsLanguageSelection}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey={'account.language'} />
            </CardTitle>

            <CardDescription>
              <Trans i18nKey={'account.languageDescription'} />
            </CardDescription>
          </CardHeader>

          <CardContent>
            <LanguageSelector locales={routing.locales} />
          </CardContent>
        </Card>
      </If>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'account.updateEmailCardTitle'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'account.updateEmailCardDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          <UpdateEmailFormContainer callbackPath={props.paths.callback} />
        </CardContent>
      </Card>

      <If condition={props.features.enablePasswordUpdate}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey={'account.updatePasswordCardTitle'} />
            </CardTitle>

            <CardDescription>
              <Trans i18nKey={'account.updatePasswordCardDescription'} />
            </CardDescription>
          </CardHeader>

          <CardContent>
            <UpdatePasswordFormContainer callbackPath={props.paths.callback} />
          </CardContent>
        </Card>
      </If>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'account.multiFactorAuth'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'account.multiFactorAuthDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          <MultiFactorAuthFactorsList userId={props.userId} />
        </CardContent>
      </Card>

      <If condition={props.features.enablePasskeys}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey={'account.passkeys'} />
            </CardTitle>

            <CardDescription>
              <Trans i18nKey={'account.passkeysDescription'} />
            </CardDescription>
          </CardHeader>

          <CardContent>
            <PasskeysList userId={props.userId} />
          </CardContent>
        </Card>
      </If>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey={'account.linkedAccounts'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'account.linkedAccountsDescription'} />
          </CardDescription>
        </CardHeader>

        <CardContent>
          <LinkAccountsList
            providers={props.providers}
            enabled={props.features.enableAccountLinking}
            showEmailOption={props.features.showLinkEmailOption}
            showPasswordOption={props.features.enablePasswordUpdate}
            redirectTo={'/home/settings'}
          />
        </CardContent>
      </Card>

      <If condition={props.features.enableAccountDeletion}>
        <Card className={'border-destructive'}>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey={'account.dangerZone'} />
            </CardTitle>

            <CardDescription>
              <Trans i18nKey={'account.dangerZoneDescription'} />
            </CardDescription>
          </CardHeader>

          <CardContent>
            <AccountDangerZone />
          </CardContent>
        </Card>
      </If>
    </div>
  );
}

function useSupportMultiLanguage() {
  const { locales } = routing;

  return locales.length > 1;
}
