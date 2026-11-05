import type { PolicyContext, PolicyResult } from '@kit/policies';
import { Database } from '@kit/supabase/database';

/**
 * Invitation policy context that extends the base PolicyContext
 * from @kit/policies for invitation-specific data.
 */
export interface FeaturePolicyInvitationContext extends PolicyContext {
  /** The account slug being invited to */
  accountSlug: string;

  /** The account ID being invited to (same as accountId from base) */
  accountId: string;

  /** Current subscription data for the account */
  subscription?: {
    id: string;
    status: Database['public']['Enums']['subscription_status'];
    provider: Database['public']['Enums']['billing_provider'];
    active: boolean;
    trial_starts_at?: string;
    trial_ends_at?: string;
    items: Array<{
      id: string;
      type: Database['public']['Enums']['subscription_item_type'];
      quantity: number;
      product_id: string;
      variant_id: string;
    }>;
  };

  /** Current number of members in the account */
  currentMemberCount: number;

  /**
   * Prospectigo : sièges encore libres (forfait − membres − invitations en attente), null = illimité.
   * Lu par lm_seats_available ; utilisé par la règle prospectigo-seat-limit.
   */
  seatsAvailable: number | null;

  /** The invitations being attempted */
  invitations: Array<{
    email: string;
    role: string;
  }>;

  /** The user performing the invitation */
  invitingUser: {
    id: string;
    email?: string;
  };
}

/**
 * Invitation policy result that extends the base PolicyResult
 * from @kit/policies while maintaining backward compatibility.
 */
export interface FeaturePolicyInvitationResult extends PolicyResult {
  /** Whether the invitations are allowed */
  allowed: boolean;

  /** Human-readable reason if not allowed */
  reason?: string;

  /** Additional metadata for logging/debugging */
  metadata?: Record<string, unknown>;
}
