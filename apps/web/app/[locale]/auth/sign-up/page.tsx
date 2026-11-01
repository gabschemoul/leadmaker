import Link from 'next/link';

import { getTranslations } from 'next-intl/server';

import { SignUpMethodsContainer } from '@kit/auth/sign-up';
import { getSafeRedirectPath } from '@kit/shared/utils';
import { Button } from '@kit/ui/button';
import { Heading } from '@kit/ui/heading';
import { Trans } from '@kit/ui/trans';

import authConfig from '~/config/auth.config';
import pathsConfig from '~/config/paths.config';

export const generateMetadata = async () => {
  const t = await getTranslations('auth');

  return {
    title: t('signUp'),
  };
};

interface SignUpPageProps {
  searchParams: Promise<{
    invite_token?: string;
    next?: string;
  }>;
}

// les jetons d'invitation sont des UUID v4 (voir add_invitations_to_account)
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un invité qui n'est pas encore connecté arrive ici avec son jeton
 * d'invitation : après l'inscription (Google ou e-mail), on le renvoie sur la
 * page d'acceptation plutôt que sur l'accueil, sinon l'app lui fait créer sa
 * propre équipe et l'invitation reste en attente.
 */
async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { invite_token: inviteToken, next } = await searchParams;

  const appHome =
    inviteToken && UUID_PATTERN.test(inviteToken)
      ? `${pathsConfig.app.joinTeam}?invite_token=${inviteToken}`
      : getSafeRedirectPath(next, pathsConfig.app.home);

  const paths = {
    callback: pathsConfig.auth.callback,
    appHome,
  };

  return (
    <>
      <div className={'flex flex-col items-center'}>
        <Heading level={2} className={'tracking-tighter'}>
          <Trans i18nKey={'auth.signUpHeading'} />
        </Heading>
      </div>

      <SignUpMethodsContainer
        providers={authConfig.providers}
        displayTermsCheckbox={authConfig.displayTermsCheckbox}
        paths={paths}
        captchaSiteKey={authConfig.captchaTokenSiteKey}
      />

      <div className={'flex justify-center'}>
        <Button
          render={
            <Link href={pathsConfig.auth.signIn}>
              <Trans i18nKey={'auth.alreadyHaveAnAccount'} />
            </Link>
          }
          variant={'link'}
          size={'sm'}
          nativeButton={false}
        />
      </div>
    </>
  );
}

export default SignUpPage;
