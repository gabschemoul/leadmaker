import { cache } from 'react';

import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import pathsConfig from '~/config/paths.config';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';
import { composeTeamWorkspace } from '~/lib/server/workspace/compose-team-workspace';

export { composeTeamWorkspace };

export type TeamAccountWorkspace = Awaited<
  ReturnType<typeof loadTeamWorkspace>
>;

/**
 * Load the account workspace data.
 * We place this function into a separate file so it can be reused in multiple places across the server components.
 *
 * This function is used in the layout component for the account workspace.
 * It is cached so that the data is only fetched once per request.
 *
 * @param accountSlug
 */
export const loadTeamWorkspace = cache(workspaceLoader);

async function workspaceLoader(accountSlug: string) {
  await connection();

  const client = getSupabaseServerClient();
  const user = await requireUserInServerComponent();
  const data = await composeTeamWorkspace(client, user, accountSlug);

  // we cannot find any record for the selected account
  // so we redirect the user to the home page
  if (!data) {
    redirect(pathsConfig.app.home);
  }

  return data;
}
