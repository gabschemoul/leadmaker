import 'server-only';
import type { PostgrestError } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';

/**
 * Erreurs des fonctions SQL Prospectigo → message affiché à l'utilisateur.
 *
 * Les fonctions SQL lèvent leurs refus « métier » avec un `hint` stable
 * (ex. `raise exception ... using hint = 'no_plan'`). Chaque action serveur
 * passe une table hint → clé de traduction ; un hint connu devient un message
 * clair, tout le reste est journalisé puis remplacé par une clé générique
 * (jamais de message technique de Postgres renvoyé au navigateur).
 */
export type RpcHintMap = Record<string, string>;

/** Préparation de formulaires (page Prospects, campagne en mode avancé). */
export const PREPARE_ERRORS: RpcHintMap = {
  no_sender: 'outreach.forms.prepare.noSender',
  no_messages: 'outreach.forms.prepare.noMessages',
  cap_reached: 'outreach.forms.prepare.capReached',
  no_plan: 'outreach.forms.prepare.noPlan',
};

/** Estimation demandée depuis le formulaire de campagne. */
export const ESTIMATE_ERRORS: RpcHintMap = {
  estimate_quota: 'campaigns.errors.estimateQuota',
  no_cities: 'campaigns.errors.estimateFailed',
};

/** Recherche d'e-mails depuis la page Prospects. */
export const FIND_EMAILS_ERRORS: RpcHintMap = {
  no_plan: 'prospects.actions.noPlan',
};

/**
 * Transforme une erreur d'appel RPC en erreur affichable et l'interrompt.
 *
 * @param scope nom court pour les journaux (`leadmaker.<scope>`)
 * @param fallback clé de traduction si le hint est inconnu
 */
export async function throwRpcError(params: {
  scope: string;
  error: PostgrestError;
  hints: RpcHintMap;
  fallback: string;
  context?: Record<string, unknown>;
}): Promise<never> {
  const { scope, error, hints, fallback, context } = params;
  const known = error.hint ? hints[error.hint] : undefined;

  if (known) {
    throw new Error(known);
  }

  const logger = await getLogger();
  logger.error(
    { name: `leadmaker.${scope}`, ...context, error },
    'Prospectigo RPC failed',
  );

  throw new Error(fallback);
}
