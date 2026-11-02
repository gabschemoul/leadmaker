import type { Database } from '@kit/supabase/database';

import type { AttemptGroup } from '~/lib/leadmaker/attempts';

/**
 * Le parcours d'une campagne, en quatre étapes dans l'ordre :
 * Cibler → Trouver → Rédiger → Contacter. Chaque étape est un onglet de la
 * page de campagne (`?etape=`), avec son propre bouton d'action.
 */
export const CAMPAIGN_STEPS = [
  'cibler',
  'trouver',
  'rediger',
  'contacter',
] as const;

export type CampaignStep = (typeof CAMPAIGN_STEPS)[number];

export type StepState = 'done' | 'active' | 'todo';

type CampaignStatus = Database['public']['Enums']['lm_campaign_status'];

/** Ce qu'il faut savoir d'une campagne pour dessiner le rail. */
export interface CampaignStepFacts {
  status: CampaignStatus;
  prospects: number;
  messagesCount: number;
  hasSender: boolean;
  attempts: Record<AttemptGroup, number>;
  /** Dernier passage du pilote automatique (roadmap n°18), null s'il n'y en a jamais eu */
  autopilot: {
    status: Database['public']['Enums']['lm_autopilot_status'];
    sent: number;
    target: number;
  } | null;
}

export function isCampaignStep(value: unknown): value is CampaignStep {
  return (
    typeof value === 'string' &&
    (CAMPAIGN_STEPS as readonly string[]).includes(value)
  );
}

export function attemptsTotal(attempts: Record<AttemptGroup, number>) {
  return Object.values(attempts).reduce((sum, count) => sum + count, 0);
}

export function stepStates(
  facts: CampaignStepFacts,
): Record<CampaignStep, StepState> {
  const total = attemptsTotal(facts.attempts);

  return {
    cibler: 'done',
    trouver:
      facts.status === 'draft'
        ? 'todo'
        : facts.status === 'running'
          ? 'active'
          : facts.prospects > 0
            ? 'done'
            : 'active',
    rediger: facts.messagesCount > 0 && facts.hasSender ? 'done' : 'todo',
    contacter:
      facts.autopilot?.status === 'running' ||
      facts.autopilot?.status === 'preview' ||
      facts.autopilot?.status === 'paused'
        ? 'active'
        : facts.attempts.sent > 0
          ? 'done'
          : total > 0
            ? 'active'
            : 'todo',
  };
}

/**
 * L'onglet ouvert par défaut : là où se trouve la prochaine action.
 * Des formulaires existent → Contacter ; campagne lancée sans message →
 * Rédiger ; recherche en cours ou pas encore lancée → Trouver ; sinon
 * Contacter (tout est prêt pour préparer les formulaires).
 */
export function defaultStep(facts: CampaignStepFacts): CampaignStep {
  if (facts.autopilot || attemptsTotal(facts.attempts) > 0) {
    return 'contacter';
  }

  if (facts.status === 'draft' || facts.status === 'running') {
    return facts.status === 'running' &&
      (facts.messagesCount === 0 || !facts.hasSender)
      ? 'rediger'
      : 'trouver';
  }

  return facts.messagesCount === 0 || !facts.hasSender
    ? 'rediger'
    : 'contacter';
}
