import 'server-only';
/**
 * Rôle : appels à Claude depuis l'appli (nouveau parcours campagne, CDC-PARCOURS-TRI-ANNUAIRE §3 et §6).
 * Données : clé ANTHROPIC_API_KEY (variable serveur Vercel, jamais envoyée au navigateur).
 * Écritures : aucune.
 * Sans clé, aiEnabled() est faux et les écrans fonctionnent sans proposition de l'IA.
 */
import Anthropic from '@anthropic-ai/sdk';

/** Propositions rapides pendant la saisie (précisions de la cible, activités) */
export const AI_FAST_MODEL = 'claude-haiku-5-5';

/** Rédaction d'un message (« Proposer avec l'IA ») : modèle intermédiaire, ~0,6 centime par proposition (décidé le 9/11) */
export const AI_WRITER_MODEL = 'claude-sonnet-5-5';

/** « Proposer avec l'IA » : propositions par organisation et par jour, au plus */
export const AI_MESSAGE_DAILY_LIMIT = 30;

let client: Anthropic | null = null;

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAiClient() {
  client ??= new Anthropic({ timeout: 20_000, maxRetries: 1 });

  return client;
}
