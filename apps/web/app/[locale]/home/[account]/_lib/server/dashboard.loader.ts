import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import {
  ATTEMPT_GROUPS,
  type AttemptGroup,
  groupOfStatus,
} from '~/lib/leadmaker/attempts';
import { parseTemplates, usableMessages } from '~/lib/leadmaker/templates';

import { type CampaignStepFacts } from '../../campaigns/_lib/steps';

type Client = SupabaseClient<Database>;

const ATTEMPT_ROWS_LIMIT = 50_000;

function emptyCounts() {
  const counts = {} as Record<AttemptGroup, number>;

  for (const group of Object.keys(ATTEMPT_GROUPS) as AttemptGroup[]) {
    counts[group] = 0;
  }

  return counts;
}

/**
 * Tout ce que le tableau de bord montre : les campagnes avec ce qu'il faut
 * pour nommer leur prochaine action, et les chiffres clés de l'organisation.
 */
export async function loadDashboard(client: Client, accountId: string) {
  const [campaigns, attempts, senders, credits, autopilots] = await Promise.all(
    [
      client
        .from('lm_campaigns')
        .select(
          'id, name, status, space_id, templates, created_at, prospects:lm_prospects(count)',
        )
        .eq('account_id', accountId)
        .neq('status', 'archived')
        .order('created_at', { ascending: false }),
      client
        .from('lm_attempts')
        .select('campaign_id, status, autopilot_id')
        .eq('account_id', accountId)
        .limit(ATTEMPT_ROWS_LIMIT),
      client
        .from('lm_sender_profiles')
        .select('space_id')
        .eq('account_id', accountId),
      client
        .from('lm_account_credits')
        .select(
          'discovery_balance, outreach_balance, plan:lm_plans(discovery_credits, outreach_credits, active_campaigns)',
        )
        .eq('account_id', accountId)
        .maybeSingle(),
      client
        .from('lm_autopilots')
        .select('id, campaign_id, status, target')
        .eq('account_id', accountId)
        .in('status', ['preview', 'running', 'paused']),
    ],
  );

  if (campaigns.error) throw campaigns.error;
  if (attempts.error) throw attempts.error;
  if (senders.error) throw senders.error;
  if (credits.error) throw credits.error;
  if (autopilots.error) throw autopilots.error;

  // messages partis par passage du pilote automatique
  const sentByAutopilot = new Map<string, number>();

  for (const row of attempts.data ?? []) {
    if (
      row.autopilot_id &&
      (row.status === 'sent' || row.status === 'to_verify')
    ) {
      sentByAutopilot.set(
        row.autopilot_id,
        (sentByAutopilot.get(row.autopilot_id) ?? 0) + 1,
      );
    }
  }

  const autopilotByCampaign = new Map(
    (autopilots.data ?? []).map((row) => [
      row.campaign_id,
      {
        status: row.status,
        target: row.target,
        sent: sentByAutopilot.get(row.id) ?? 0,
      },
    ]),
  );

  const countsByCampaign = new Map<string, Record<AttemptGroup, number>>();
  const totals = emptyCounts();

  for (const row of attempts.data ?? []) {
    if (!row.campaign_id) continue;

    const counts = countsByCampaign.get(row.campaign_id) ?? emptyCounts();
    const group = groupOfStatus(row.status);
    counts[group] += 1;
    totals[group] += 1;
    countsByCampaign.set(row.campaign_id, counts);
  }

  const spacesWithSender = new Set(
    (senders.data ?? []).map((row) => row.space_id),
  );

  const rows = (campaigns.data ?? []).map((campaign) => {
    const facts: CampaignStepFacts = {
      status: campaign.status,
      prospects: campaign.prospects?.[0]?.count ?? 0,
      messagesCount: usableMessages(parseTemplates(campaign.templates)).length,
      hasSender: spacesWithSender.has(campaign.space_id),
      attempts: countsByCampaign.get(campaign.id) ?? emptyCounts(),
      autopilot: autopilotByCampaign.get(campaign.id) ?? null,
    };

    return { id: campaign.id, name: campaign.name, facts };
  });

  const plan = credits.data?.plan ?? null;

  return {
    campaigns: rows,
    kpis: {
      discoveryBalance: credits.data?.discovery_balance ?? 0,
      discoveryMonthly: plan?.discovery_credits ?? null,
      outreachBalance: credits.data?.outreach_balance ?? 0,
      outreachMonthly: plan?.outreach_credits ?? null,
      toReview: totals.ready + totals.to_verify + totals.incomplete,
      activeCampaigns: rows.filter((row) => row.facts.status === 'running')
        .length,
      activeCampaignsMax: plan?.active_campaigns ?? null,
    },
  };
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
