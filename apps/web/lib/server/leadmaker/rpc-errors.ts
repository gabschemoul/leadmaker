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

/** Lancement / reprise d'une campagne (lm_start_campaign). */
export const START_ERRORS: RpcHintMap = {
  no_credits: 'campaigns.errors.noCredits',
  cap_reached: 'campaigns.errors.capReached',
  campaign_limit: 'campaigns.errors.campaignLimit',
  no_cities: 'campaigns.errors.noCities',
  archived: 'campaigns.errors.archived',
};

/** Cible en mots d'une campagne (lm_set_sort_target, écran « Qui ? »). */
export const SORT_TARGET_ERRORS: RpcHintMap = {
  sort_target_required: 'campaigns.form.who.targetRequired',
};

/** Choix du client sur les entreprises « À vérifier » (lm_choose_prospects). */
export const CHOOSE_PROSPECTS_ERRORS: RpcHintMap = {
  invalid_choice: 'campaigns.companies.chooseFailed',
};

/** Groupes d'une campagne (lm_set_groups_choice, lm_split_campaign_by_groups) : encart de « Vos entreprises ». */
export const GROUPS_ERRORS: RpcHintMap = {
  invalid_choice: 'campaigns.companies.groups.choiceFailed',
  no_groups: 'campaigns.companies.groups.noGroups',
  already_split: 'campaigns.companies.groups.alreadySplit',
};

/** Modification d'une campagne (lm_update_campaign) : pays figé après lancement. */
export const UPDATE_CAMPAIGN_ERRORS: RpcHintMap = {
  country_locked: 'campaigns.errors.countryLocked',
};

/** Messages d'une campagne : validation automatique hors forfait (déclencheur SQL). */
export const TEMPLATES_ERRORS: RpcHintMap = {
  plan: 'outreach.messages.autoValidationPlan',
};

/** Pilote automatique (lm_start/update/pause/resume/confirm/cancel_autopilot). */
export const AUTOPILOT_ERRORS: RpcHintMap = {
  not_found: 'campaigns.autopilot.errors.notFound',
  no_sender: 'campaigns.autopilot.errors.noSender',
  no_messages: 'campaigns.autopilot.errors.noMessages',
  messages: 'campaigns.autopilot.errors.messages',
  active: 'campaigns.autopilot.errors.active',
  no_prospects: 'campaigns.autopilot.errors.noProspects',
  no_credits: 'campaigns.autopilot.errors.noCredits',
  target: 'campaigns.autopilot.errors.target',
  schedule: 'campaigns.autopilot.errors.schedule',
  not_active: 'campaigns.autopilot.errors.notActive',
  archived: 'campaigns.errors.archived',
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
