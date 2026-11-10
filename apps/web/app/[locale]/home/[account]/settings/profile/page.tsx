import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { PersonalAccountSettingsContainer } from '@kit/accounts/personal-account-settings';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Skeleton } from '@kit/ui/skeleton';

import { CardLoading } from '~/components/skeletons/card-loading';
import authConfig from '~/config/auth.config';
import featureFlagsConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { NotificationPreferences } from '../_components/notification-preferences';

const showEmailOption =
  authConfig.providers.password ||
  authConfig.providers.magicLink ||
  authConfig.providers.otp;

const features = {
  showLinkEmailOption: showEmailOption,
  enablePasswordUpdate: authConfig.providers.password,
  enableAccountDeletion: featureFlagsConfig.enableAccountDeletion,
  enableAccountLinking: authConfig.enableIdentityLinking,
  enablePasskeys: authConfig.providers.passkey,
};

const providers = authConfig.providers.oAuth;

export const generateMetadata = async () => {
  const t = await getTranslations('account');
  const title = t('settingsTab');

  return {
    title,
  };
};

interface TeamProfileSettingsPageProps {
  params: Promise<{ account: string }>;
}

function TeamProfileSettingsPage({ params }: TeamProfileSettingsPageProps) {
  return (
    <div className={'flex w-full flex-1 flex-col'}>
      <Suspense
        fallback={
          <div className={'flex flex-col gap-8'}>
            <CardLoading
              titleKey={'account.notifications.title'}
              descriptionKey={'account.notifications.description'}
              rows={3}
            />

            <CardLoading
              titleKey={'account.accountImage'}
              descriptionKey={'account.accountImageDescription'}
            >
              <Skeleton className={'size-20 rounded-full'} />
            </CardLoading>

            <CardLoading
              titleKey={'account.name'}
              descriptionKey={'account.nameDescription'}
              content={'fields'}
              rows={1}
            />
          </div>
        }
      >
        <ProfileSettings params={params} />
      </Suspense>
    </div>
  );
}

export default TeamProfileSettingsPage;

/** The session is what makes this per-request, so it waits behind the boundary. */
async function ProfileSettings({ params }: TeamProfileSettingsPageProps) {
  const [user, { account }] = await Promise.all([
    requireUserInServerComponent(),
    params,
  ]);

  const profilePath = pathsConfig.app.accountProfileSettings.replace(
    '[account]',
    account,
  );

  const paths = {
    callback: pathsConfig.auth.callback + `?next=${profilePath}`,
  };

  // Notifications par e-mail coupées par l'utilisateur (aucune ligne = tout activé)
  const { data: preferences } = await getSupabaseServerClient()
    .from('lm_notification_preferences')
    .select('disabled_groups')
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <div className={'flex flex-col gap-8'}>
      <NotificationPreferences
        disabledGroups={preferences?.disabled_groups ?? []}
      />

      <PersonalAccountSettingsContainer
        userId={user.id}
        features={features}
        paths={paths}
        providers={providers}
      />
    </div>
  );
}
