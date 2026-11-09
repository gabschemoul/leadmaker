'use server';

/**
 * Rôle : propositions de l'IA sur l'écran « Qui ? » (CDC-PARCOURS-TRI-ANNUAIRE §3) : précisions de la cible en
 * puces et activités à chercher, d'après la phrase du client.
 * Données : lm_categories (présélection par recherche texte, client Supabase de l'utilisateur) puis Claude Haiku
 * (ai.service.ts). Sans clé IA : présélection seule, sans précisions.
 * Écritures : aucune. Le client choisit toujours lui-même ses activités (règle n°10).
 */
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AI_FAST_MODEL,
  aiEnabled,
  getAiClient,
} from '~/lib/server/leadmaker/ai.service';

import { foldSearch } from './search-text';

const SuggestTargetSchema = z.object({
  phrase: z.string().trim().min(3).max(300),
  locale: z.enum(['fr', 'en']).default('fr'),
});

const AiSuggestion = z.object({
  refinements: z.array(z.string()).max(5),
  gcids: z.array(z.string()).max(15),
});

/** Activité proposée (code et libellés) */
type CategoryOption = { gcid: string; label_fr: string; label_en: string };

/** Activités candidates envoyées à l'IA au plus */
const PRESELECT_LIMIT = 80;

const SYSTEM = `Tu aides un client de Prospectigo à décrire les entreprises qu'il veut contacter.
On te donne sa phrase (sa cible) et une liste d'activités possibles (code gcid, libellés).

1. refinements : 3 à 5 précisions courtes qui rendraient sa cible plus nette, chacune un bout de phrase à
   ajouter tel quel à sa phrase (par exemple « sans celles qui font du web », « 2 personnes ou plus »,
   « avec un vrai site »). Dans la langue de sa phrase, sans répéter ce qu'elle dit déjà.
2. gcids : les activités de la liste qui correspondent à sa cible (1 à 15, les plus pertinentes d'abord).
   Seulement des codes de la liste.`;

export const suggestTargetAction = authActionClient
  .inputSchema(SuggestTargetSchema)
  .action(async ({ parsedInput: { phrase, locale } }) => {
    const candidates = await preselectCategories(phrase);

    if (!aiEnabled() || candidates.length === 0) {
      return { refinements: [], categories: candidates.slice(0, 10), ai: false };
    }

    try {
      const list = candidates
        .map((c) => `${c.gcid} | ${c.label_fr} | ${c.label_en}`)
        .join('\n');

      const response = await getAiClient().messages.parse({
        model: AI_FAST_MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(AiSuggestion) },
        messages: [
          {
            role: 'user',
            content: `Phrase du client (${locale}) : ${phrase}\n\nActivités possibles :\n${list}`,
          },
        ],
      });

      const parsed = response.parsed_output;

      if (!parsed) {
        return { refinements: [], categories: candidates.slice(0, 10), ai: false };
      }

      const byGcid = new Map(candidates.map((c) => [c.gcid, c]));
      const categories = parsed.gcids
        .map((gcid) => byGcid.get(gcid))
        .filter((c): c is CategoryOption => Boolean(c));

      return {
        refinements: parsed.refinements
          .map((r) => r.trim())
          .filter((r) => r.length > 0 && r.length <= 80),
        categories,
        ai: true,
      };
    } catch (error) {
      const logger = await getLogger();
      logger.warn({ name: 'leadmaker.ai.suggest', error }, 'AI suggestion failed');

      return { refinements: [], categories: candidates.slice(0, 10), ai: false };
    }
  });

/**
 * Activités dont le libellé contient un des mots de la phrase (pluriel simple retiré), activités exclues
 * (administrations, banques) écartées.
 */
async function preselectCategories(phrase: string): Promise<CategoryOption[]> {
  const client = getSupabaseServerClient();
  const words = [
    ...new Set(
      foldSearch(phrase)
        .split(' ')
        // lettres et chiffres seulement : la ponctuation casserait le filtre de la base
        .map((w) => w.replace(/[^a-z0-9]/g, ''))
        .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
        .filter((w) => w.length >= 3),
    ),
  ].slice(0, 8);

  if (words.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from('lm_categories')
    .select('gcid, label_fr, label_en')
    .eq('is_excluded', false)
    .or(words.map((w) => `search_key.ilike.*${w}*`).join(','))
    .order('is_generic', { ascending: false })
    .limit(PRESELECT_LIMIT);

  if (error) {
    const logger = await getLogger();
    logger.error({ name: 'leadmaker.ai.preselect', error }, 'Category preselection failed');

    return [];
  }

  return data ?? [];
}
