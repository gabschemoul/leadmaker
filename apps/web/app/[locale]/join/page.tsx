import { Suspense } from 'react';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';

import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { AuthLayoutShell } from '@kit/auth/auth-layout';
import { MultiFactorAuthError, requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { AcceptInvitationContainer } from '@kit/team-accounts/components';
import { Button } from '@kit/ui/button';
import { Heading } from '@kit/ui/heading';
import { Trans } from '@kit/ui/trans';

import { AppLogo } from '~/components/app-logo';
import authConfig from '~/config/auth.config';
import pathsConfig from '~/config/paths.config';

interface JoinTeamAccountPageProps {
  searchParams: Promise<{
    invite_token?: string;
    type?: 'invite' | 'magic-link';
    email?: string;
    is_new_user?: string;
    error?: string;
  }>;
}

/**
 * Error codes emitted by the /join/accept route, mapped to translation keys.
 * The route sends a code rather than a message so nothing from the query string
 * is rendered verbatim; anything unrecognized falls back to the generic key.
 */
const JOIN_ERROR_CODES = new Map([
  ['invalid-link', 'teams.inviteErrorInvalidLink'],
  ['not-found', 'teams.inviteErrorNotFound'],
  ['unknown', 'teams.inviteErrorUnknown'],
]);

export const generateMetadata = async () => {
  const t = await getTranslations('teams');

  return {
    title: t('joinTeamAccount'),
  };
};

function JoinTeamAccountPage(props: JoinTeamAccountPageProps) {
  return (
    <Suspense fallback={null}>
      <JoinTeamAccountContent searchParams={props.searchParams} />
    </Suspense>
  );
}

/** The proxy already gated auth; the checks below are defence in depth. */
async function JoinTeamAccountContent(props: JoinTeamAccountPageProps) {
  const searchParams = await props.searchParams;
  const token = searchParams.invite_token;

  // the /join/accept route redirects here with an error code when it cannot
  // process the link. It carries no invite_token, so this must be handled
  // before the missing-token check below — otherwise every such failure would
  // render as a bare 404 and the invitee would never learn what went wrong.
  if (searchParams.error) {
    // a Map, not an object literal: an object lookup would resolve inherited
    // keys (`?error=toString` returning Object.prototype.toString), which `??`
    // does not fall back on
    const i18nKey =
      JOIN_ERROR_CODES.get(searchParams.error) ?? 'teams.inviteErrorUnknown';

    return (
      <AuthLayoutShell Logo={AppLogo}>
        <InviteError i18nKey={i18nKey} />
      </AuthLayoutShell>
    );
  }

  // no token, redirect to 404
  if (!token) {
    notFound();
  }

  await connection();

  const client = getSupabaseServerClient();
  const auth = await requireUser(client);

  // if the user is not logged in or there is an error
  // redirect to the sign up page with the invite token
  // so that they will get back to this page after signing up
  if (auth.error ?? !auth.data) {
    if (auth.error instanceof MultiFactorAuthError) {
      const urlParams = new URLSearchParams({
        next: `${pathsConfig.app.joinTeam}?invite_token=${token}&email=${searchParams.email ?? ''}`,
      });

      const verifyMfaUrl = `${pathsConfig.auth.verifyMfa}?${urlParams.toString()}`;

      // if the user needs to verify MFA
      // redirect them to the MFA verification page
      redirect(verifyMfaUrl);
    } else {
      const urlParams = new URLSearchParams({
        invite_token: token,
        next: `${pathsConfig.app.joinTeam}?invite_token=${token}`,
      });

      const nextUrl = `${pathsConfig.auth.signUp}?${urlParams.toString()}`;

      // redirect to the sign up page with the invite token
      redirect(nextUrl);
    }
  }

  // get api to interact with team accounts
  const adminClient = getSupabaseServerAdminClient();
  const api = createTeamAccountsApi(client);

  // the user is logged in, we can now check if the token is valid
  const invitation = await api.getInvitation(adminClient, token);

  if (!invitation) {
    return (
      <AuthLayoutShell Logo={AppLogo}>
        <InviteNotFoundOrExpired />
      </AuthLayoutShell>
    );
  }

  // the invitation is not found or expired or the email is not the same as the user's email (case insensitive)
  const isInvitationValid =
    invitation.email.toLowerCase() === auth.data.email?.toLowerCase();

  if (!isInvitationValid) {
    return (
      <AuthLayoutShell Logo={AppLogo}>
        <InviteNotFoundOrExpired />
      </AuthLayoutShell>
    );
  }

  // we need to verify the user isn't already in the account
  // we do so by checking if the user has a role on the account
  const { data: isAlreadyTeamMember } = await client.rpc(
    'has_role_on_account',
    {
      account_id: invitation.account.id,
    },
  );

  // if the user is already in the account redirect to the home page
  if (isAlreadyTeamMember) {
    const { getLogger } = await import('@kit/shared/logger');
    const logger = await getLogger();

    logger.warn(
      {
        name: 'join-team-account',
        accountId: invitation.account.id,
        userId: auth.data.id,
      },
      'User is already in the account. Redirecting to account page.',
    );

    // if the user is already in the account redirect to the home page
    redirect(pathsConfig.app.home);
  }

  // if the user decides to sign in with a different account
  // we redirect them to the sign in page with the invite token
  const signOutNext = `${pathsConfig.auth.signIn}?invite_token=${token}`;

  // once the user accepts the invitation, we redirect them to the account home page
  const accountHome = pathsConfig.app.accountHome.replace(
    '[account]',
    invitation.account.slug,
  );

  // Determine if we should show the account setup step (Step 2)
  // Decision logic:
  // 1. Only show for new accounts (is_new_user === 'true' or linkType === 'invite')
  // 2. Only if we don't support email only auth (magic link or OTP)
  // 3. Users can always skip and set up auth later in account settings
  const linkType = searchParams.type;
  const isNewUserParam = searchParams.is_new_user === 'true';

  // if the app supports email only auth, we don't need to setup any other auth methods. In all other cases (passowrd, oauth), we need to setup at least one of them.
  const supportsEmailOnlyAuth =
    authConfig.providers.magicLink || authConfig.providers.otp;

  const isNewAccount = isNewUserParam || linkType === 'invite';
  const shouldSetupAccount = isNewAccount && !supportsEmailOnlyAuth;

  // Determine redirect destination after joining:
  // - If shouldSetupAccount: redirect to /identities with next param (Step 2)
  // - Otherwise: redirect directly to team home (skip Step 2)
  const nextPath = shouldSetupAccount
    ? `/identities?next=${encodeURIComponent(accountHome)}`
    : accountHome;

  const email = auth.data.email ?? '';

  return (
    <AuthLayoutShell Logo={AppLogo}>
      <AcceptInvitationContainer
        email={email}
        inviteToken={token}
        invitation={invitation}
        paths={{
          signOutNext,
          nextPath,
        }}
      />
    </AuthLayoutShell>
  );
}

export default JoinTeamAccountPage;

function InviteError(props: { i18nKey: string }) {
  return (
    <div className={'flex flex-col space-y-4'} data-test={'join-invite-error'}>
      <Heading level={6}>
        <Trans i18nKey={'teams.inviteErrorHeading'} />
      </Heading>

      <p className={'text-muted-foreground text-sm'}>
        <Trans i18nKey={props.i18nKey} />
      </p>

      <Button
        render={
          <Link href={pathsConfig.app.home}>
            <ArrowLeft className={'mr-2 w-4'} />
            <Trans i18nKey={'teams.backToHome'} />
          </Link>
        }
        nativeButton={false}
        className={'w-full'}
        variant={'outline'}
      />
    </div>
  );
}

function InviteNotFoundOrExpired() {
  return (
    <div className={'flex flex-col space-y-4'}>
      <Heading level={6}>
        <Trans i18nKey={'teams.inviteNotFoundOrExpired'} />
      </Heading>

      <p className={'text-muted-foreground text-sm'}>
        <Trans i18nKey={'teams.inviteNotFoundOrExpiredDescription'} />
      </p>

      <Button
        render={
          <Link href={pathsConfig.app.home}>
            <ArrowLeft className={'mr-2 w-4'} />
            <Trans i18nKey={'teams.backToHome'} />
          </Link>
        }
        nativeButton={false}
        className={'w-full'}
        variant={'outline'}
      />
    </div>
  );
}
