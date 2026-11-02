import { Suspense } from 'react';

import Link from 'next/link';

import { getTranslations } from 'next-intl/server';

import { SignInMethodsContainer } from '@kit/auth/sign-in';
import { getSafeRedirectPath } from '@kit/shared/utils';
import { Button } from '@kit/ui/button';
import { Heading } from '@kit/ui/heading';
import { Skeleton } from '@kit/ui/skeleton';
import { Trans } from '@kit/ui/trans';

import authConfig from '~/config/auth.config';
import pathsConfig from '~/config/paths.config';

interface SignInPageProps {
  searchParams: Promise<{
    next?: string;
  }>;
}

export const generateMetadata = async () => {
  const t = await getTranslations('auth');

  return {
    title: t('signIn'),
  };
};

function SignInPage({ searchParams }: SignInPageProps) {
  return (
    <>
      <div className={'flex flex-col items-center'}>
        <Heading level={2} className={'text-center font-light'}>
          <Trans
            i18nKey={'auth.signInHeading'}
            values={{ productName: process.env.NEXT_PUBLIC_PRODUCT_NAME }}
          />
        </Heading>
      </div>

      <Suspense fallback={<AuthFormFallback />}>
        <SignInMethods searchParams={searchParams} />
      </Suspense>

      <div className={'flex justify-center'}>
        <Button
          nativeButton={false}
          variant={'link'}
          size={'sm'}
          render={
            <Link href={pathsConfig.auth.signUp}>
              <Trans i18nKey={'auth.doNotHaveAccountYet'} />
            </Link>
          }
        />
      </div>
    </>
  );
}

export default SignInPage;

function AuthFormFallback() {
  return (
    <div className={'flex w-full flex-col space-y-4'}>
      <Skeleton className={'h-10 w-full'} />
      <Skeleton className={'h-10 w-full'} />
      <Skeleton className={'h-10 w-full'} />
    </div>
  );
}

async function SignInMethods({ searchParams }: SignInPageProps) {
  const { next } = await searchParams;

  const paths = {
    callback: pathsConfig.auth.callback,
    returnPath: getSafeRedirectPath(next, pathsConfig.app.home),
    joinTeam: pathsConfig.app.joinTeam,
  };

  return (
    <SignInMethodsContainer
      paths={paths}
      providers={authConfig.providers}
      captchaSiteKey={authConfig.captchaTokenSiteKey}
    />
  );
}
