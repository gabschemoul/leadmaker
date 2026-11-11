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
  /** nom court de campagne (2 à 5 mots), sans lieu */
  name: z.string(),
  /** numéros (dans la liste envoyée) des activités qui correspondent à la cible */
  picks: z.array(z.number().int()),
});

/** Activité proposée (code, libellés, famille) */
type CategoryOption = {
  gcid: string;
  label_fr: string;
  label_en: string;
  family: string;
};

/** Activités trouvées par les mots de la phrase, au plus */
const MATCH_LIMIT = 300;

/** Activités candidates envoyées à l'IA, au plus (familles entières comprises) */
const CANDIDATE_LIMIT = 900;

/** Familles dépliées en entier : celles où tombent le plus d'activités trouvées par les mots */
const TOP_FAMILIES = 2;

/** Activités proposées au plus (11/11 : 15 laissait de côté pizzerias, brasseries… d'une cible « Restaurants ») */
const MAX_PICKS = 400;

/** Mots vides ignorés pour retrouver les activités (« Restaurants, sans les chaînes, avec un site »). */
const STOP_WORDS = new Set([
  'les',
  'des',
  'une',
  'avec',
  'sans',
  'pour',
  'dans',
  'qui',
  'que',
  'ont',
  'sont',
  'leur',
  'leurs',
  'aux',
  'par',
  'sur',
  'plus',
  'moins',
  'tous',
  'toutes',
  'tout',
  'celles',
  'ceux',
  'entreprises',
  'entreprise',
  'societe',
  'societes',
  'professionnel',
  'professionnels',
  'the',
  'and',
  'with',
  'without',
  'for',
  'that',
  'who',
  'their',
  'companies',
  'company',
  'businesses',
  'business',
  'chaine',
  'chaines',
  'nationale',
  'nationales',
  'national',
  'ligne',
  'carte',
  'vrai',
  'propre',
  'independant',
  'independants',
  'independante',
  'independantes',
  'petite',
  'petites',
  'grande',
  'grandes',
]);

const SYSTEM = `Tu aides un client de Prospectigo à décrire les entreprises qu'il veut contacter.
On te donne sa phrase (sa cible) et une liste numérotée d'activités possibles (numéro | libellés | famille).

1. refinements : 3 à 5 précisions courtes qui rendraient sa cible plus nette, chacune un bout de phrase à
   ajouter tel quel à sa phrase (par exemple « sans celles qui font du web », « 2 personnes ou plus »,
   « avec un vrai site »). Dans la langue de sa phrase, sans répéter ce qu'elle dit déjà. Jamais de précision de
   lieu (pays, ville, région) : la zone se choisit à part.
2. name : un nom de campagne court et clair, 2 à 5 mots, dans la langue de sa phrase, sans lieu
   (par exemple « Restaurants indépendants », « Agences web », « Plombiers chauffagistes »).
3. picks : les numéros de TOUTES les activités de la liste qui correspondent à sa cible, sans en oublier :
   pour « Restaurants », toutes les sortes de restaurants (italien, japonais, pizzeria, brasserie, crêperie…).
   N'écarte que celles qui ne sont pas sa cible (pour « Restaurants » : boulangerie, bar sans cuisine, épicerie…).
   Les plus pertinentes d'abord.`;

export const suggestTargetAction = authActionClient
  .inputSchema(SuggestTargetSchema)
  .action(async ({ parsedInput: { phrase, locale } }) => {
    const candidates = await preselectCategories(phrase);
    const fallback = {
      refinements: [] as string[],
      name: '',
      categories: candidates.slice(0, 10),
      ai: false,
    };

    if (!aiEnabled() || candidates.length === 0) {
      return fallback;
    }

    try {
      const list = candidates
        .map(
          (c, index) =>
            `${index + 1} | ${c.label_fr} / ${c.label_en} | ${c.family}`,
        )
        .join('\n');

      const response = await getAiClient().messages.parse({
        model: AI_FAST_MODEL,
        max_tokens: 4000,
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
        return fallback;
      }

      const categories = [
        ...new Set(
          parsed.picks.filter((n) => n >= 1 && n <= candidates.length),
        ),
      ]
        .slice(0, MAX_PICKS)
        .map((n) => candidates[n - 1]!);

      return {
        refinements: parsed.refinements
          .map((r) => r.trim())
          .filter((r) => r.length > 0 && r.length <= 80),
        name: parsed.name.trim().slice(0, 80),
        categories,
        ai: true,
      };
    } catch (error) {
      const logger = await getLogger();
      logger.warn(
        { name: 'leadmaker.ai.suggest', error },
        'AI suggestion failed',
      );

      return fallback;
    }
  });

/**
 * Activités candidates : celles dont le libellé contient un mot utile de la phrase (mots vides et pluriel simple
 * retirés), puis toutes les activités des familles où elles tombent le plus (« Restaurants » amène toute la
 * famille Restauration : pizzerias, brasseries, crêperies… que les mots seuls ne trouvent pas). Activités exclues
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
        .filter((w) => !STOP_WORDS.has(w))
        .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
    ),
  ].slice(0, 8);

  if (words.length === 0) {
    return [];
  }

  const logError = async (error: unknown) => {
    const logger = await getLogger();
    logger.error(
      { name: 'leadmaker.ai.preselect', error },
      'Category preselection failed',
    );
  };

  const { data: matched, error } = await client
    .from('lm_categories')
    .select('gcid, label_fr, label_en, family')
    .eq('is_excluded', false)
    .or(words.map((w) => `search_key.ilike.*${w}*`).join(','))
    .order('is_generic', { ascending: false })
    .limit(MATCH_LIMIT);

  if (error) {
    await logError(error);

    return [];
  }

  const rows = matched ?? [];
  const perFamily = new Map<string, number>();

  for (const row of rows) {
    perFamily.set(row.family, (perFamily.get(row.family) ?? 0) + 1);
  }

  const families = [...perFamily.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_FAMILIES)
    .map(([family]) => family);

  if (families.length === 0) {
    return rows;
  }

  const { data: familyRows, error: familyError } = await client
    .from('lm_categories')
    .select('gcid, label_fr, label_en, family')
    .eq('is_excluded', false)
    .in('family', families)
    .order('is_generic', { ascending: false })
    .order('label_fr', { ascending: true })
    .limit(CANDIDATE_LIMIT);

  if (familyError) {
    await logError(familyError);

    return rows;
  }

  const seen = new Set<string>();

  return [...rows, ...(familyRows ?? [])]
    .filter((row) => {
      if (seen.has(row.gcid)) {
        return false;
      }

      seen.add(row.gcid);

      return true;
    })
    .slice(0, CANDIDATE_LIMIT);
}
