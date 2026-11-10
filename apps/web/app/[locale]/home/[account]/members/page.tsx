import { Suspense } from 'react';

import { connection } from 'next/server';

import { PlusCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  AccountInvitationsTable,
  AccountMembersTable,
  InviteMembersDialogContainer,
} from '@kit/team-accounts/components';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { CardSkeleton, Delayed } from '~/components/skeletons/page-skeletons';

// local imports
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import {
  canAddMember,
  loadAccountInvitations,
  loadAccountMembers,
} from './_lib/server/members-page.loader';

interface TeamAccountMembersPageProps {
  params: Promise<{ account: string }>;
}

type Params = TeamAccountMembersPageProps['params'];

export const generateMetadata = async () => {
  const t = await getTranslations('teams');
  const title = t('members.pageTitle');

  return {
    title,
  };
};

/**
 * The two cards load independently, so a slow invitations query no longer holds
 * up the members table.
 */
function TeamAccountMembersPage({ params }: TeamAccountMembersPageProps) {
  return (
    <PageBody>
      {/* titre fixe : affiché tout de suite, sans attendre le serveur */}
      <TeamAccountLayoutPageHeader
        title={<Trans i18nKey={'common.routes.members'} />}
      />

      <div className={'flex w-full flex-col space-y-4 pb-32'}>
        <Suspense
          fallback={
            <Delayed>
              <CardSkeleton rows={4} />
            </Delayed>
          }
        >
          <MembersCard params={params} />
        </Suspense>

        <Suspense
          fallback={
            <Delayed>
              <CardSkeleton rows={2} />
            </Delayed>
          }
        >
          <InvitationsCard params={params} />
        </Suspense>
      </div>
    </PageBody>
  );
}

export default TeamAccountMembersPage;

async function MembersCard({ params }: { params: Params }) {
  await connection();

  const client = getSupabaseServerClient();
  const slug = (await params).account;

  const [members, { user, account }, canInvite] = await Promise.all([
    loadAccountMembers(client, slug),
    loadTeamWorkspace(slug),
    canAddMember(),
  ]);

  const canManageRoles = account.permissions.includes('roles.manage');
  const canManageInvitations = account.permissions.includes('invites.manage');

  return (
    <Card>
      <CardHeader className={'flex flex-row justify-between'}>
        <div className={'flex flex-col space-y-1.5'}>
          <CardTitle>
            <Trans i18nKey={'common.accountMembers'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'common.membersTabDescription'} />
          </CardDescription>
        </div>

        <If condition={canManageInvitations && canInvite}>
          <InviteMembersDialogContainer
            userRoleHierarchy={account.role_hierarchy_level}
            accountId={account.id}
            accountSlug={account.slug}
          >
            <Button size={'sm'} data-test={'invite-members-form-trigger'}>
              <PlusCircle className={'w-4'} />

              <span>
                <Trans i18nKey={'teams.inviteMembersButton'} />
              </span>
            </Button>
          </InviteMembersDialogContainer>
        </If>
      </CardHeader>

      <CardContent>
        <AccountMembersTable
          userRoleHierarchy={account.role_hierarchy_level}
          currentUserId={user.id}
          currentAccountId={account.id}
          members={members}
          isPrimaryOwner={account.primary_owner_user_id === user.id}
          canManageRoles={canManageRoles}
        />
      </CardContent>
    </Card>
  );
}

async function InvitationsCard({ params }: { params: Params }) {
  await connection();

  const client = getSupabaseServerClient();
  const slug = (await params).account;

  const [invitations, { account }] = await Promise.all([
    loadAccountInvitations(client, slug),
    loadTeamWorkspace(slug),
  ]);

  const canManageRoles = account.permissions.includes('roles.manage');

  return (
    <Card>
      <CardHeader className={'flex flex-row justify-between'}>
        <div className={'flex flex-col space-y-1.5'}>
          <CardTitle>
            <Trans i18nKey={'teams.pendingInvitesHeading'} />
          </CardTitle>

          <CardDescription>
            <Trans i18nKey={'teams.pendingInvitesDescription'} />
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <AccountInvitationsTable
          permissions={{
            canUpdateInvitation: canManageRoles,
            canRemoveInvitation: canManageRoles,
            currentUserRoleHierarchy: account.role_hierarchy_level,
          }}
          invitations={invitations}
        />
      </CardContent>
    </Card>
  );
}
