'use server';

/**
 * Rôle : propositions de l'IA sur l'écran « Qui ? » (CDC-PARCOURS-TRI-ANNUAIRE §3) : précisions de la cible en
 * puces et activités à chercher, d'après la phrase du client.
 * Données : catalogue lm_categories (catalog.ts, client Supabase de l'utilisateur), Claude Haiku (familles) puis
 * Claude Sonnet (activités, nom, lieu) (ai.service.ts). Sans clé IA : activités trouvées par les mots seulement.
 * Écritures : aucune. Le client choisit toujours lui-même ses activités (règle n°10).
 */
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AI_FAST_MODEL,
  AI_WRITER_MODEL,
  aiEnabled,
  getAiClient,
} from '~/lib/server/leadmaker/ai.service';

import { loadCatalog } from './catalog';
import { foldSearch } from './search-text';

const SuggestTargetSchema = z.object({
  phrase: z.string().trim().min(3).max(300),
  locale: z.enum(['fr', 'en']).default('fr'),
});

/** Réponse rapide (Haiku, ~1 s) : précisions, nom, lieux — séparée des activités (5 à 10 s) pour que le nom et la
 * zone suivent la phrase tout de suite (retour du 11/11 : rien ne changeait après la première phrase). */
const AiTarget = z.object({
  refinements: z.array(z.string()).max(5),
  /** nom de campagne : résume la cible, sans rien inventer */
  name: z.string(),
  /** villes citées dans la phrase (« Restaurants à Lyon et Villeurbanne ») et code pays ISO */
  places: z.object({
    cities: z.array(z.string()),
    country_code: z.string().nullable(),
  }),
});

/**
 * Choix famille par famille (11/11 : une liste de numéros à cocher un par un oubliait des activités, comme
 * « Brasserie » pour « Restaurants ») : toute la famille sauf quelques-unes, ou seulement quelques-unes.
 */
const AiActivities = z.object({
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

const TARGET_SYSTEM = `Tu aides un client de Prospectigo à décrire les entreprises qu'il veut contacter. On te donne sa
phrase (sa cible).

1. refinements : 3 à 5 précisions courtes qui rendraient sa cible plus nette, chacune un bout de phrase à
   ajouter tel quel à sa phrase (par exemple « sans celles qui font du web », « 2 personnes ou plus »).
   Dans la langue de sa phrase, sans répéter ce qu'elle dit déjà. Jamais de précision de lieu.
2. name : un nom de campagne court (2 à 6 mots), naturel, qui RÉSUME intelligemment la cible comme le ferait un
   commercial : reformule, regroupe, retire le superflu, garde les lieux s'il y en a. N'ajoute JAMAIS un critère
   que le client n'a pas donné. Exemples : « Restaurants, sans les chaînes nationales, avec une carte en ligne ou
   un site web » → « Restaurants hors chaînes avec site » ; « je cherche des plombiers et des chauffagistes sur
   Lyon et autour » → « Plombiers et chauffagistes Lyon » ; « Brasseries en France » → « Brasseries en France ».
3. places : cities = TOUTES les villes citées dans la phrase (« Restaurants à Lyon et Villeurbanne » → ["Lyon",
   "Villeurbanne"]), [] s'il n'y en a pas ; country_code = code ISO du pays cité ou de ces villes, sinon null.`;

const ACTIVITIES_SYSTEM = `Tu aides un client de Prospectigo à choisir les activités des entreprises qu'il veut contacter.
On te donne sa phrase (sa cible) et des activités possibles, rangées par famille et numérotées
(numéro | libellé français / libellé anglais).

families : pour CHAQUE famille de la liste :
- take_all = true quand la cible couvre la plupart des activités de la famille (« Restaurants » : la famille
  Restauration). Alors drop = les numéros des SEULES activités qui ne sont pas du tout la cible (pour
  « Restaurants » : boulangerie, épicerie, magasin de mobilier, fabrication de bière, glacier sans salle…).
  Tout ce qui n'est pas dans drop est coché : chaque sorte de restaurant (italien, grec, burgers, sushis,
  brasserie, pizzeria, crêperie…) doit rester hors de drop. keep = [].
- take_all = false sinon. Alors keep = les numéros de TOUTES les activités qui correspondent à la cible (pour
  « Brasseries » : chaque activité de brasserie et de bar à bière), drop = []. keep vide si rien ne correspond.
En cas de doute sur une activité, coche-la. Le lieu cité dans la phrase ne compte pas ici.`;

/** Familles choisies par l'IA (numéros dans la liste des familles) */
const AiFamilies = z.object({ families: z.array(z.number().int()) });

/** Exemples d'activités montrés pour chaque famille à la première étape */
const FAMILY_EXAMPLES = 25;

/** Familles ajoutées d'office : celles où tombent le plus d'activités trouvées par les mots de la phrase */
const WORD_FAMILIES = 3;

/** Passes de la seconde étape, réunies (11/11 : une seule passe oubliait des activités d'une fois sur l'autre) */
const PICK_RUNS = 2;

const FAMILIES_SYSTEM = `On te donne la cible d'un client et la liste numérotée des familles d'activités (avec des exemples).
Donne les NUMÉROS de TOUTES les familles qui peuvent contenir des entreprises de sa cible (en cas de doute, inclus-la).`;

/**
 * Précisions, nom de la campagne et villes citées, d'après la phrase (Claude Haiku, ~1 s).
 */
export const suggestTargetAction = authActionClient
  .inputSchema(SuggestTargetSchema)
  .action(async ({ parsedInput: { phrase, locale } }) => {
    const empty = {
      refinements: [] as string[],
      name: '',
      places: null as { cities: string[]; countryCode: string | null } | null,
    };

    if (!aiEnabled()) {
      return empty;
    }

    try {
      const response = await getAiClient().messages.parse({
        model: AI_FAST_MODEL,
        max_tokens: 2000,
        system: TARGET_SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(AiTarget) },
        messages: [
          { role: 'user', content: `Phrase du client (${locale}) : ${phrase}` },
        ],
      });
      const parsed = response.parsed_output;

      if (!parsed) {
        return empty;
      }

      const cities = parsed.places.cities
        .map((city) => city.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 20);
      const countryCode =
        parsed.places.country_code?.trim().toUpperCase() || null;

      return {
        refinements: parsed.refinements
          .map((r) => r.trim())
          .filter((r) => r.length > 0 && r.length <= 80),
        name: parsed.name.trim().slice(0, 80),
        places:
          cities.length > 0
            ? {
                cities,
                countryCode:
                  countryCode && /^[A-Z]{2}$/.test(countryCode)
                    ? countryCode
                    : null,
              }
            : null,
      };
    } catch (error) {
      const logger = await getLogger();
      logger.warn({ name: 'leadmaker.ai.target', error }, 'AI target failed');

      return empty;
    }
  });

/**
 * Activités proposées d'après la phrase, en deux étapes (11/11/2026, mesuré sur 18 cibles variées contre une
 * relecture exhaustive du catalogue : 91 % des bonnes activités trouvées, contre ~55 % en ne regardant que les
 * activités dont le nom contient un mot de la phrase — « Entreprises du BTP » en trouvait 0) :
 * 1. Claude Haiku choisit les familles concernées (+ les familles des mots de la phrase) ;
 * 2. Claude Sonnet voit TOUTES les activités de ces familles et choisit famille par famille (deux passes réunies :
 *    le client préfère trop que pas assez).
 */
export const suggestActivitiesAction = authActionClient
  .inputSchema(SuggestTargetSchema)
  .action(async ({ parsedInput: { phrase, locale } }) => {
    const client = getSupabaseServerClient();
    const [words, catalog] = await Promise.all([
      preselectCategories(phrase),
      loadCatalog(client),
    ]);
    const fallback = { categories: words.slice(0, 10), ai: false };

    if (!aiEnabled() || !catalog.data || catalog.data.length === 0) {
      return fallback;
    }

    const byFamily = new Map<string, CategoryOption[]>();

    for (const row of catalog.data) {
      byFamily.set(row.family, [...(byFamily.get(row.family) ?? []), row]);
    }

    const familyNames = [...byFamily.keys()].sort((a, b) =>
      a.localeCompare(b, 'fr'),
    );

    try {
      const ai = getAiClient();
      const familyList = familyNames
        .map(
          (family, index) =>
            `${index + 1}. ${family} (ex. : ${(byFamily.get(family) ?? [])
              .slice(0, FAMILY_EXAMPLES)
              .map((c) => c.label_fr)
              .join(', ')})`,
        )
        .join('\n');

      const step1 = await ai.messages.parse({
        model: AI_FAST_MODEL,
        max_tokens: 4000,
        system: FAMILIES_SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(AiFamilies) },
        messages: [
          {
            role: 'user',
            content: `Cible : ${phrase}\n\nFamilles :\n${familyList}`,
          },
        ],
      });

      const families = new Set(
        (step1.parsed_output?.families ?? [])
          .filter((n) => n >= 1 && n <= familyNames.length)
          .map((n) => familyNames[n - 1]!),
      );

      const wordFamilies = new Map<string, number>();

      for (const row of words) {
        wordFamilies.set(row.family, (wordFamilies.get(row.family) ?? 0) + 1);
      }

      [...wordFamilies.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, WORD_FAMILIES)
        .forEach(([family]) => families.add(family));

      if (families.size === 0) {
        return fallback;
      }

      const candidates = [...families].flatMap((family) =>
        [...(byFamily.get(family) ?? [])].sort((a, b) =>
          a.label_fr.localeCompare(b.label_fr, 'fr'),
        ),
      );
      const indexesByFamily = new Map<string, number[]>();

      candidates.forEach((c, index) => {
        indexesByFamily.set(c.family, [
          ...(indexesByFamily.get(c.family) ?? []),
          index,
        ]);
      });

      const list = [...indexesByFamily.entries()]
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

      const runs = await Promise.all(
        Array.from({ length: PICK_RUNS }, () =>
          ai.messages
            .parse({
              model: AI_WRITER_MODEL,
              max_tokens: 16000,
              system: ACTIVITIES_SYSTEM,
              output_config: {
                effort: 'low',
                format: zodOutputFormat(AiActivities),
              },
              messages: [
                {
                  role: 'user',
                  content: `Phrase du client (${locale}) : ${phrase}\n\nActivités possibles :\n${list}`,
                },
              ],
            })
            .then((response) => response.parsed_output)
            .catch(() => null),
        ),
      );

      const parsed = runs.find((run) => run !== null);

      if (!parsed) {
        return fallback;
      }

      // toutes les activités retenues par l'une ou l'autre passe, sans plafond (demande ferme de Gabriel, 11/11)
      const chosen = new Set<number>();

      for (const run of runs) {
        for (const [family, indexes] of indexesByFamily) {
          const choice = run?.families.find((f) => f.family === family);

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
      }

      const categories = [...chosen]
        .sort((a, b) => a - b)
        .map((i) => candidates[i]!);
      return {
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
 * Activités dont le libellé contient un mot utile de la phrase (mots vides et pluriel simple retirés) : servent
 * à ajouter leurs familles à celles choisies par l'IA, et de repli quand l'IA ne répond pas. Activités exclues
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

  const { data, error } = await client
    .from('lm_categories')
    .select('gcid, label_fr, label_en, family')
    .eq('is_excluded', false)
    .or(words.map((w) => `search_key.ilike.*${w}*`).join(','))
    .order('is_generic', { ascending: false })
    .limit(MATCH_LIMIT);

  if (error) {
    const logger = await getLogger();
    logger.error(
      { name: 'leadmaker.ai.preselect', error },
      'Category preselection failed',
    );

    return [];
  }

  return data ?? [];
}
