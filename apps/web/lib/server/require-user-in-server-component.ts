import 'server-only';
import { cache } from 'react';

import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import pathsConfig from '~/config/paths.config.ts';

/**
 * @name requireUserInServerComponent
 * @description Require the user to be authenticated in a server component.
 * We reuse this function in multiple server components - it is cached so that the data is only fetched once per request.
 * Use this instead of `requireUser` in server components, so you don't need to hit the database multiple times in a single request.
 */
export const requireUserInServerComponent = cache(async () => {
  await connection();

  const client = getSupabaseServerClient();

  const result = await requireUser(client, {
    signInPath: pathsConfig.auth.signIn,
    mfaVerifyPath: pathsConfig.auth.verifyMfa,
  });

  if (result.error) {
    redirect(result.redirectTo);
  }

  return result.data;
});
