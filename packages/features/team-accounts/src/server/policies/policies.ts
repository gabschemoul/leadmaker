import { allow, definePolicy, deny } from '@kit/policies';
import { createPolicyRegistry } from '@kit/policies';

import { FeaturePolicyInvitationContext } from './feature-policy-invitation-context';

/**
 * Feature-specific registry for invitation policies
 */
export const invitationPolicyRegistry = createPolicyRegistry();

/**
 * Subscription required policy
 * Checks if the account has an active subscription
 */
export const subscriptionRequiredInvitationsPolicy =
  definePolicy<FeaturePolicyInvitationContext>({
    id: 'subscription-required',
    stages: ['preliminary', 'submission'],
    evaluate: async ({ subscription }) => {
      if (!subscription || !subscription.active) {
        return deny({
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'teams.policyErrors.subscriptionRequired',
          remediation: 'teams.policyRemediation.subscriptionRequired',
        });
      }

      return allow();
    },
  });

/**
 * Paddle billing policy
 * Checks if the account has a paddle subscription and is in a trial period
 */
export const paddleBillingInvitationsPolicy =
  definePolicy<FeaturePolicyInvitationContext>({
    id: 'paddle-billing',
    stages: ['preliminary', 'submission'],
    evaluate: async ({ subscription }) => {
      // combine with subscriptionRequiredPolicy if subscription must be required
      if (!subscription) {
        return allow();
      }

      // Paddle specific constraint: cannot update subscription items during trial
      if (
        subscription.provider === 'paddle' &&
        subscription.status === 'trialing'
      ) {
        const hasPerSeatItems = subscription.items.some(
          (item) => item.type === 'per_seat',
        );

        if (hasPerSeatItems) {
          return deny({
            code: 'PADDLE_TRIAL_RESTRICTION',
            message: 'teams.policyErrors.paddleTrialRestriction',
            remediation: 'teams.policyRemediation.paddleTrialRestriction',
          });
        }
      }

      return allow();
    },
  });

// register policies below to apply them
//
//

/**
 * Prospectigo (audit 5/11/2026, E15) : on ne peut pas inviter plus de personnes que de sièges libres du
 * forfait (Growth 1, Business 3, Scale 6). Sans cette règle, l'invitation partait et l'invité butait sur une
 * erreur au moment d'accepter (déclencheur lm_enforce_seat_quota).
 */
export const prospectigoSeatLimitPolicy =
  definePolicy<FeaturePolicyInvitationContext>({
    id: 'prospectigo-seat-limit',
    stages: ['preliminary', 'submission'],
    evaluate: async ({ seatsAvailable, invitations }) => {
      if (seatsAvailable === null) {
        return allow();
      }

      if (seatsAvailable <= 0 || invitations.length > seatsAvailable) {
        return deny({
          code: 'SEAT_LIMIT',
          message: 'teams.policyErrors.seatLimit',
          remediation: 'teams.policyRemediation.seatLimit',
        });
      }

      return allow();
    },
  });

invitationPolicyRegistry.registerPolicy(prospectigoSeatLimitPolicy);
