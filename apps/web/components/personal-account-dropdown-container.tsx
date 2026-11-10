'use client';

import { PersonalAccountDropdown } from '@kit/accounts/personal-account-dropdown';
import { useSignOut } from '@kit/supabase/hooks/use-sign-out';
import { useUser } from '@kit/supabase/hooks/use-user';
import { JWTUserData } from '@kit/supabase/types';

import featuresFlagConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';

const features = {
  enableThemeToggle: featuresFlagConfig.enableThemeToggle,
};

export function ProfileAccountDropdownContainer(props: {
  user?: JWTUserData | null;
  showProfileName?: boolean;
  accountSlug?: string;

  account?: {
    id: string | null;
    name: string | null;
    picture_url: string | null;
  };
}) {
  const signOut = useSignOut();
  const user = useUser(props.user);
  const userData = user.data;

  if (!userData) {
    return null;
  }

  const homePath =
    featuresFlagConfig.enableTeamsOnly && props.accountSlug
      ? pathsConfig.app.accountHome.replace('[account]', props.accountSlug)
      : pathsConfig.app.home;

  return (
    <PersonalAccountDropdown
      className={'w-full'}
      paths={{
        home: homePath,
        profile: props.accountSlug
          ? pathsConfig.app.accountProfileSettings.replace(
              '[account]',
              props.accountSlug,
            )
          : undefined,
      }}
      features={features}
      user={userData}
      account={props.account}
      signOutRequested={() => signOut.mutateAsync()}
      showProfileName={props.showProfileName}
    />
  );
}
