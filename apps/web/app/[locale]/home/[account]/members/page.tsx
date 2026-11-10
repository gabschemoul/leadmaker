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
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { TableLoading } from '~/components/skeletons/table-loading';

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
 * Cartes, titres, recherche et colonnes affichés tout de suite (10/11/2026) ; seules les lignes (membres,
 * invitations) et le bouton d'invitation (selon les droits) attendent la base, chacun de son côté.
 */
function TeamAccountMembersPage({ params }: TeamAccountMembersPageProps) {
  return (
    <PageBody>
      {/* titre fixe : affiché tout de suite, sans attendre le serveur */}
      <TeamAccountLayoutPageHeader
        title={<Trans i18nKey={'common.routes.members'} />}
      />

      {/* cartes, titres, recherche et colonnes fixes tout de suite ; seules les lignes attendent la base */}
      <div className={'flex w-full flex-col space-y-4 pb-32'}>
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

            <Suspense fallback={null}>
              <InviteButton params={params} />
            </Suspense>
          </CardHeader>

          <CardContent>
            <Suspense
              fallback={
                <TableLoading
                  searchPlaceholder={'teams.searchMembersPlaceholder'}
                  headers={[
                    'teams.memberName',
                    'teams.emailLabel',
                    'teams.roleLabel',
                    'teams.joinedAtLabel',
                    '',
                  ]}
                  rows={3}
                />
              }
            >
              <MembersTable params={params} />
            </Suspense>
          </CardContent>
        </Card>

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
            <Suspense
              fallback={
                <TableLoading
                  searchPlaceholder={'teams.searchInvitations'}
                  headers={[
                    'teams.emailLabel',
                    'teams.roleLabel',
                    'teams.invitedAtLabel',
                    'teams.expiresAtLabel',
                    'teams.inviteStatus',
                    '',
                  ]}
                  rows={1}
                />
              }
            >
              <InvitationsTable params={params} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </PageBody>
  );
}

export default TeamAccountMembersPage;

async function InviteButton({ params }: { params: Params }) {
  await connection();

  const slug = (await params).account;
  const [{ account }, canInvite] = await Promise.all([
    loadTeamWorkspace(slug),
    canAddMember(),
  ]);

  if (!account.permissions.includes('invites.manage') || !canInvite) {
    return null;
  }

  return (
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
  );
}

async function MembersTable({ params }: { params: Params }) {
  await connection();

  const client = getSupabaseServerClient();
  const slug = (await params).account;

  const [members, { user, account }] = await Promise.all([
    loadAccountMembers(client, slug),
    loadTeamWorkspace(slug),
  ]);

  return (
    <AccountMembersTable
      userRoleHierarchy={account.role_hierarchy_level}
      currentUserId={user.id}
      currentAccountId={account.id}
      members={members}
      isPrimaryOwner={account.primary_owner_user_id === user.id}
      canManageRoles={account.permissions.includes('roles.manage')}
    />
  );
}

async function InvitationsTable({ params }: { params: Params }) {
  await connection();

  const client = getSupabaseServerClient();
  const slug = (await params).account;

  const [invitations, { account }] = await Promise.all([
    loadAccountInvitations(client, slug),
    loadTeamWorkspace(slug),
  ]);

  const canManageRoles = account.permissions.includes('roles.manage');

  return (
    <AccountInvitationsTable
      permissions={{
        canUpdateInvitation: canManageRoles,
        canRemoveInvitation: canManageRoles,
        currentUserRoleHierarchy: account.role_hierarchy_level,
      }}
      invitations={invitations}
    />
  );
}
