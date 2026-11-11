import {
  type CampaignStep,
  type CampaignStepFacts,
  attemptsTotal,
} from './steps';

/**
 * La prochaine action d'une campagne, pour le tableau de bord : où en est-on,
 * et quel bouton cliquer. `kind` dit si l'utilisateur doit agir (`todo`),
 * si Prospectigo travaille (`working`) ou si la campagne est au bout (`done`).
 */
export interface NextAction {
  kind: 'todo' | 'working' | 'done';
  /** clé sous campaigns.nextAction.* */
  key: string;
  values: Record<string, number>;
  step: CampaignStep;
  /** sous-onglet de l'étape Contacter */
  statut?: string;
}

export function nextAction(facts: CampaignStepFacts): NextAction {
  const { attempts } = facts;
  const total = attemptsTotal(attempts);

  if (facts.status === 'draft') {
    return { kind: 'todo', key: 'launch', values: {}, step: 'trouver' };
  }

  // Audit E13 : une recherche arrêtée faute de crédits n'est pas une pause comme une autre
  if (facts.status === 'paused' && facts.pausedReason === 'no_credits') {
    return {
      kind: 'todo',
      key: 'noCredits',
      values: { count: facts.prospects },
      step: 'trouver',
    };
  }

  // Plafond fixé par le client atteint (11/11/2026)
  if (facts.status === 'paused' && facts.pausedReason === 'cap_reached') {
    return { kind: 'todo', key: 'capReached', values: {}, step: 'cibler' };
  }

  // Crédit unique (9/11) : moins de 6 % des entreprises trouvées correspondent à la cible
  if (facts.status === 'paused' && facts.pausedReason === 'too_hard') {
    return {
      kind: 'todo',
      key: 'tooHard',
      values: {},
      step: 'cibler',
    };
  }

  if (!facts.hasSender) {
    return { kind: 'todo', key: 'sender', values: {}, step: 'rediger' };
  }

  if (facts.messagesCount === 0) {
    return {
      kind: 'todo',
      key: 'message',
      values: { count: facts.prospects },
      step: 'rediger',
    };
  }

  // Pilote automatique (roadmap n°18)
  if (facts.autopilot?.status === 'preview') {
    return {
      kind: 'todo',
      key: 'autopilotPreview',
      values: {},
      step: 'contacter',
    };
  }

  if (facts.autopilot?.status === 'paused') {
    return {
      kind: 'todo',
      key: 'autopilotPaused',
      values: { sent: facts.autopilot.sent, target: facts.autopilot.target },
      step: 'contacter',
    };
  }

  if (facts.autopilot?.status === 'running') {
    return {
      kind: 'working',
      key: 'autopilot',
      values: { sent: facts.autopilot.sent, target: facts.autopilot.target },
      step: 'contacter',
    };
  }

  if (attempts.ready > 0) {
    return {
      kind: 'todo',
      key: 'review',
      values: { count: attempts.ready },
      step: 'contacter',
      statut: 'ready',
    };
  }

  if (attempts.to_verify > 0) {
    return {
      kind: 'todo',
      key: 'verifySent',
      values: { count: attempts.to_verify },
      step: 'contacter',
      statut: 'to_verify',
    };
  }

  if (attempts.incomplete > 0) {
    return {
      kind: 'todo',
      key: 'complete',
      values: { count: attempts.incomplete },
      step: 'contacter',
      statut: 'incomplete',
    };
  }

  if (attempts.preparing > 0) {
    return {
      kind: 'working',
      key: 'preparing',
      values: { count: attempts.preparing },
      step: 'contacter',
      statut: 'preparing',
    };
  }

  if (attempts.validated > 0) {
    return {
      kind: 'working',
      key: 'sending',
      values: { validated: attempts.validated, sent: attempts.sent },
      step: 'contacter',
      statut: 'validated',
    };
  }

  if (facts.status === 'running') {
    return {
      kind: 'working',
      key: 'searching',
      values: { count: facts.prospects },
      step: 'trouver',
    };
  }

  if (facts.prospects > 0 && total === 0) {
    return {
      kind: 'todo',
      key: 'prepare',
      values: { count: facts.prospects },
      step: 'contacter',
    };
  }

  // Audit E13 : « Terminée » seulement quand il ne reste plus personne à contacter
  const remaining = Math.max(0, facts.prospects - total);

  if (attempts.sent > 0 && remaining > 0) {
    return {
      kind: 'todo',
      key: 'contactMore',
      values: { sent: attempts.sent, remaining },
      step: 'contacter',
    };
  }

  if (attempts.sent > 0) {
    return {
      kind: 'done',
      key: 'finished',
      values: { sent: attempts.sent },
      step: 'contacter',
      statut: 'sent',
    };
  }

  if (facts.status === 'paused') {
    return {
      kind: 'todo',
      key: 'resume',
      values: { count: facts.prospects },
      step: 'trouver',
    };
  }

  return {
    kind: 'done',
    key: 'noProspects',
    values: {},
    step: 'cibler',
  };
}

const KIND_ORDER: Record<NextAction['kind'], number> = {
  todo: 0,
  working: 1,
  done: 2,
};

/** Les campagnes qui attendent l'utilisateur d'abord, puis celles qui tournent, puis les terminées. */
export function compareNextActions(a: NextAction, b: NextAction) {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}
