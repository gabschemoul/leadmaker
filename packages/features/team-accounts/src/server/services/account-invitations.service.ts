import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';

import { addDays, formatISO } from 'date-fns';
import * as z from 'zod';

import { getLogger } from '@kit/shared/logger';
import { Database } from '@kit/supabase/database';

import type { DeleteInvitationSchema } from '../../schema/delete-invitation.schema';
import type { InviteMembersSchema } from '../../schema/invite-members.schema';
import type { UpdateInvitationSchema } from '../../schema/update-invitation.schema';
import { createAccountInvitationsDispatchService } from './account-invitations-dispatcher.service';

/**
 *
 * Create an account invitations service.
 */
export function createAccountInvitationsService(
  client: SupabaseClient<Database>,
) {
  return new AccountInvitationsService(client);
}

/**
 * @name AccountInvitationsService
 * @description Service for managing account invitations.
 */
class AccountInvitationsService {
  private readonly namespace = 'invitations';

  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * @name deleteInvitation
   * @description Removes an invitation from the database.
   * @param params
   */
  async deleteInvitation(params: z.output<typeof DeleteInvitationSchema>) {
    const logger = await getLogger();

    const ctx = {
      name: this.namespace,
      ...params,
    };

    logger.info(ctx, 'Removing invitation...');

    const { data, error } = await this.client
      .from('invitations')
      .delete()
      .match({
        id: params.invitationId,
      });

    if (error) {
      logger.error(ctx, `Failed to remove invitation`);

      throw error;
    }

    logger.info(ctx, 'Invitation successfully removed');

    return data;
  }

  /**
   * @name updateInvitation
   * @param params
   * @description Updates an invitation in the database.
   */
  async updateInvitation(params: z.output<typeof UpdateInvitationSchema>) {
    const logger = await getLogger();

    const ctx = {
      name: this.namespace,
      ...params,
    };

    logger.info(ctx, 'Updating invitation...');

    const { data, error } = await this.client
      .from('invitations')
      .update({
        role: params.role,
      })
      .match({
        id: params.invitationId,
      });

    if (error) {
      logger.error(
        {
          ...ctx,
          error,
        },
        'Failed to update invitation',
      );

      throw error;
    }

    logger.info(ctx, 'Invitation successfully updated');

    return data;
  }

  async validateInvitation(
    invitation: z.output<typeof InviteMembersSchema>['invitations'][number],
    accountSlug: string,
  ) {
    const { data: members, error } = await this.client.rpc(
      'get_account_members',
      {
        account_slug: accountSlug,
      },
    );

    if (error) {
      throw error;
    }

    const invitationEmail = normalizeEmail(invitation.email);

    const isUserAlreadyMember = members.find((member) => {
      return normalizeEmail(member.email) === invitationEmail;
    });

    if (isUserAlreadyMember) {
      throw new Error('User already member of the team');
    }
  }

  /**
   * @name sendInvitations
   * @description Sends invitations to join a team.
   * @param accountId - The team the caller was authorized for.
   * @param accountSlug - That team's current slug; the SQL functions below are keyed by slug.
   * @param invitations
   */
  async sendInvitations({
    accountId,
    accountSlug,
    invitations,
    invitedBy,
    language,
  }: {
    invitations: z.output<typeof InviteMembersSchema>['invitations'];
    accountId: string;
    accountSlug: string;
    invitedBy: string;
    language?: string;
  }) {
    const logger = await getLogger();

    const ctx = {
      accountId,
      accountSlug,
      name: this.namespace,
    };

    logger.info(ctx, 'Storing invitations...');

    try {
      await Promise.all(
        invitations.map((invitation) =>
          this.validateInvitation(invitation, accountSlug),
        ),
      );
    } catch (error) {
      logger.error(
        {
          ...ctx,
          error: (error as Error).message,
        },
        'Error validating invitations',
      );

      throw error;
    }

    const accountResponse = await this.client
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .single();

    if (!accountResponse.data) {
      logger.error(
        ctx,
        'Account not found in database. Cannot send invitations.',
      );

      throw new Error('Account not found');
    }

    const response = await this.client.rpc('add_invitations_to_account', {
      invitations,
      account_slug: accountSlug,
      invited_by: invitedBy,
    });

    if (response.error) {
      logger.error(
        {
          ...ctx,
          error: response.error,
        },
        `Failed to add invitations to account ${accountSlug}`,
      );

      throw response.error;
    }

    const responseInvitations = Array.isArray(response.data)
      ? response.data
      : [response.data];

    // The RPC resolves the team from the slug at insert time. If a rename moved
    // the slug to another team since the caller was authorized, the rows landed
    // there: remove them before any invitation email goes out.
    const misplaced = responseInvitations.filter(
      (invitation) => invitation.account_id !== accountId,
    );

    if (misplaced.length) {
      logger.error(
        { ...ctx, misplacedAccountIds: misplaced.map((i) => i.account_id) },
        'Team slug changed while sending invitations. Removing them.',
      );

      const { error } = await this.client
        .from('invitations')
        .delete()
        .in(
          'id',
          misplaced.map((invitation) => invitation.id),
        );

      if (error) {
        logger.error(
          { ...ctx, error },
          'Failed to remove misplaced invitations',
        );
      }

      throw new Error('Team slug changed while sending invitations');
    }

    logger.info(
      {
        ...ctx,
        count: responseInvitations.length,
      },
      'Invitations added to account',
    );

    await this.dispatchInvitationEmails(ctx, responseInvitations, language);
  }

  /**
   * @name acceptInvitationToTeam
   * @description Accepts an invitation to join a team.
   */
  async acceptInvitationToTeam(
    adminClient: SupabaseClient<Database>,
    params: {
      userId: string;
      userEmail: string;
      inviteToken: string;
    },
  ) {
    const logger = await getLogger();

    const ctx = {
      name: this.namespace,
      userId: params.userId,
      inviteTokenFingerprint: getSecretFingerprint(params.inviteToken),
    };

    logger.info(ctx, 'Accepting invitation to team');

    const invitation = await adminClient
      .from('invitations')
      .select('email')
      .eq('invite_token', params.inviteToken)
      .single();

    if (invitation.error) {
      logger.error(
        {
          ...ctx,
          error: invitation.error,
        },
        'Failed to get invitation',
      );
    }

    // if the invitation email does not match the user email, throw an error.
    // NB: the comparison is case-insensitive. Supabase Auth lowercases emails at
    // sign-up, so an invitation stored before normalization (or written by
    // another client) may legitimately differ in case from the user's email.
    if (
      !invitation.data?.email ||
      normalizeEmail(invitation.data.email) !== normalizeEmail(params.userEmail)
    ) {
      logger.error({
        ...ctx,
        error: 'Invitation email does not match user email',
      });

      throw new Error('Invitation email does not match user email');
    }

    const { error, data } = await adminClient.rpc('accept_invitation', {
      token: params.inviteToken,
      user_id: params.userId,
    });

    if (error) {
      logger.error(
        {
          ...ctx,
          error,
        },
        'Failed to accept invitation to team',
      );

      throw error;
    }

    logger.info(ctx, 'Successfully accepted invitation to team');

    return data;
  }

  /**
   * @name renewInvitation
   * @description Renews an invitation to join a team by extending the expiration date by 7 days.
   * @param invitationId
   */
  async renewInvitation(invitationId: number) {
    const logger = await getLogger();

    const ctx = {
      invitationId,
      name: this.namespace,
    };

    logger.info(ctx, 'Renewing invitation...');

    const sevenDaysFromNow = formatISO(addDays(new Date(), 7));

    const { data, error } = await this.client
      .from('invitations')
      .update({
        expires_at: sevenDaysFromNow,
      })
      .match({
        id: invitationId,
      });

    if (error) {
      logger.error(
        {
          ...ctx,
          error,
        },
        'Failed to renew invitation',
      );

      throw error;
    }

    logger.info(ctx, 'Invitation successfully renewed');

    return data;
  }

  /**
   * @name dispatchInvitationEmails
   * @description Dispatches invitation emails to the invited users.
   * @param ctx
   * @param invitations
   * @returns
   */
  private async dispatchInvitationEmails(
    ctx: { accountSlug: string; name: string },
    invitations: Database['public']['Tables']['invitations']['Row'][],
    language?: string,
  ) {
    if (!invitations.length) {
      return;
    }

    const logger = await getLogger();
    const service = createAccountInvitationsDispatchService(this.client);

    const results = await Promise.allSettled(
      invitations.map(async (invitation) => {
        // Generate internal link that will validate and generate auth token on-demand
        // This solves the 24-hour auth token expiry issue
        const link = service.getAcceptInvitationLink(invitation.invite_token);

        // send the invitation email
        const data = await service.sendInvitationEmail({
          invitation,
          link,
          language,
        });

        // return the result
        return {
          id: invitation.id,
          data,
        };
      }),
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value.data.success) {
        logger.error(
          {
            ...ctx,
            invitationId:
              result.status === 'fulfilled' ? result.value.id : result.reason,
          },
          'Failed to send invitation email',
        );
      }
    }

    const succeeded = results.filter(
      (result) => result.status === 'fulfilled' && result.value.data.success,
    );

    if (succeeded.length) {
      logger.info(
        {
          ...ctx,
          count: succeeded.length,
        },
        'Invitation emails successfully sent!',
      );
    }
  }
}

/**
 * @name normalizeEmail
 * @description Canonicalizes an email for comparison. Supabase Auth lowercases
 * emails at sign-up, so every comparison between an invitation address and a
 * user address must be case-insensitive.
 */
export function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? '';
}

function getSecretFingerprint(value: string) {
  if (value.length <= 8) {
    return '[redacted]';
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
