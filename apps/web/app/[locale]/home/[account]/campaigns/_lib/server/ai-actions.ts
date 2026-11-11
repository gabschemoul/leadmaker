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
  /** nom de campagne : les mots du client, raccourcis, sans rien inventer */
  name: z.string(),
  /** lieu cité dans la phrase (« Restaurants à Lyon ») : ville et code pays ISO, sinon null */
  place: z.object({
    city: z.string().nullable(),
    country_code: z.string().nullable(),
  }),
  /**
   * Choix famille par famille (11/11 : une liste de numéros à cocher un par un oubliait des activités, comme
   * « Brasserie » pour « Restaurants ») : toute la famille sauf quelques-unes, ou seulement quelques-unes.
   * Essayé sur le vrai catalogue : « Restaurants » → 488 activités (brasserie, pizzeria, crêperie…), 40 écartées.
   */
  families: z.array(
    z.object({
      family: z.string(),
      /** vrai : toute la famille sauf « drop » ; faux : seulement « keep » */
      take_all: z.boolean(),
      drop: z.array(z.number().int()),
      keep: z.array(z.number().int()),
    }),
  ),
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

/** Activités par famille lues au plus (la plus grande en compte ~530) : garde-fou, jamais un plafond réel */
const FAMILY_READ_LIMIT = 5000;

/** Familles dépliées en entier : celles où tombent le plus d'activités trouvées par les mots */
const TOP_FAMILIES = 2;

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
On te donne sa phrase (sa cible) et des activités possibles, rangées par famille et numérotées
(numéro | libellé français / libellé anglais).

1. refinements : 3 à 5 précisions courtes qui rendraient sa cible plus nette, chacune un bout de phrase à
   ajouter tel quel à sa phrase (par exemple « sans celles qui font du web », « 2 personnes ou plus »).
   Dans la langue de sa phrase, sans répéter ce qu'elle dit déjà. Jamais de précision de lieu.
2. name : le nom de la campagne = les mots du client, raccourcis à 2 à 6 mots, SANS RIEN INVENTER ni ajouter
   (« Brasseries en France » → « Brasseries en France » ; « Restaurants, sans les chaînes nationales, avec un
   site » → « Restaurants sans chaînes »). Garde le lieu s'il est dans la phrase.
3. place : la ville citée dans la phrase (« Restaurants à Lyon » → city « Lyon », country_code « FR »), sinon
   city null ; country_code = code ISO du pays cité ou de la ville, sinon null.
4. families : pour CHAQUE famille de la liste :
   - take_all = true quand la cible couvre la plupart des activités de la famille (« Restaurants » : la famille
     Restauration). Alors drop = les numéros des SEULES activités qui ne sont pas du tout la cible (pour
     « Restaurants » : boulangerie, épicerie, magasin de mobilier, fabrication de bière, glacier sans salle…).
     Tout ce qui n'est pas dans drop est coché : chaque sorte de restaurant (italien, grec, burgers, sushis,
     brasserie, pizzeria, crêperie…) doit rester hors de drop. keep = [].
   - take_all = false sinon. Alors keep = les numéros de TOUTES les activités qui correspondent à la cible (pour
     « Brasseries » : chaque activité de brasserie et de bar à bière), drop = []. keep vide si rien ne correspond.
   En cas de doute sur une activité, coche-la.`;

export const suggestTargetAction = authActionClient
  .inputSchema(SuggestTargetSchema)
  .action(async ({ parsedInput: { phrase, locale } }) => {
    const candidates = await preselectCategories(phrase);
    const fallback = {
      refinements: [] as string[],
      name: '',
      place: null as { city: string; countryCode: string | null } | null,
      categories: candidates.slice(0, 10),
      ai: false,
    };

    if (!aiEnabled() || candidates.length === 0) {
      return fallback;
    }

    try {
      const byFamily = new Map<string, number[]>();

      candidates.forEach((c, index) => {
        byFamily.set(c.family, [...(byFamily.get(c.family) ?? []), index]);
      });

      const list = [...byFamily.entries()]
        .map(
          ([family, indexes]) =>
            `## Famille : ${family}\n` +
            indexes
              .map((i) => {
                const c = candidates[i]!;

                return `${i + 1} | ${c.label_fr} / ${c.label_en}`;
              })
              .join('\n'),
        )
        .join('\n\n');

      const response = await getAiClient().messages.parse({
        model: AI_FAST_MODEL,
        max_tokens: 8000,
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

      // toutes les activités retenues, sans plafond (demande ferme de Gabriel, 11/11)
      const chosen = new Set<number>();

      for (const [family, indexes] of byFamily) {
        const choice = parsed.families.find((f) => f.family === family);

        if (!choice) {
          continue;
        }

        if (choice.take_all) {
          const drop = new Set(choice.drop.map((n) => n - 1));
          indexes.filter((i) => !drop.has(i)).forEach((i) => chosen.add(i));
        } else {
          const keep = new Set(choice.keep.map((n) => n - 1));
          indexes.filter((i) => keep.has(i)).forEach((i) => chosen.add(i));
        }
      }

      const categories = [...chosen]
        .sort((a, b) => a - b)
        .map((i) => candidates[i]!);
      const city = parsed.place.city?.trim() || null;
      const countryCode =
        parsed.place.country_code?.trim().toUpperCase() || null;

      return {
        refinements: parsed.refinements
          .map((r) => r.trim())
          .filter((r) => r.length > 0 && r.length <= 80),
        name: parsed.name.trim().slice(0, 80),
        place: city
          ? {
              city: city.slice(0, 100),
              countryCode:
                countryCode && /^[A-Z]{2}$/.test(countryCode)
                  ? countryCode
                  : null,
            }
          : null,
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
    .limit(FAMILY_READ_LIMIT);

  if (familyError) {
    await logError(familyError);

    return rows;
  }

  const seen = new Set<string>();

  return [...rows, ...(familyRows ?? [])].filter((row) => {
    if (seen.has(row.gcid)) {
      return false;
    }

    seen.add(row.gcid);

    return true;
  });
}
