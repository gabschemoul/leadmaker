/**
 * Rôle : chargeurs serveur des pages campagnes (liste, détail, formulaire de modification, aperçu, réglages).
 * Données : lm_campaigns, lm_geo_cities, lm_categories, lm_prospects, lm_campaign_prospects (aperçu des gardées) ; RPC lm_campaign_prospect_counts, lm_local_discovery_state, lm_auto_validation_allowed.
 * Écritures : aucune (lecture seule, client Supabase de l'utilisateur).
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { keptCompaniesFilter } from '~/lib/leadmaker/sorted-companies-query';

type Client = SupabaseClient<Database>;

/**
 * Campagnes de l'organisation, avec leur dossier client et le nombre de prospects trouvés.
 * Le nombre vient de lm_campaign_prospect_counts (un parcours d'index par campagne) : le comptage embarqué de
 * PostgREST passait par la RLS ligne à ligne et dépassait le délai de 8 s (12/11/2026, 261 000 fiches, erreur 500).
 * Un comptage en échec ne bloque jamais la liste : la colonne reste vide.
 */
export async function loadCampaigns(client: Client, accountId: string) {
  const [{ data, error }, counts, favorites] = await Promise.all([
    client
      .from('lm_campaigns')
      .select('id, name, status, country_code, created_at, space_id')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false }),
    loadCampaignProspectCounts(client, accountId),
    loadFavoriteCampaignIds(client, accountId),
  ]);

  if (error) {
    throw error;
  }

  return (data ?? []).map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    countryCode: campaign.country_code,
    createdAt: campaign.created_at,
    spaceId: campaign.space_id,
    prospects: counts?.get(campaign.id) ?? null,
    favorite: favorites.has(campaign.id),
  }));
}

/**
 * Campagnes épinglées par l'utilisateur (lm_campaign_favorites, 13/11/2026 ; la RLS ne montre que les siennes).
 * Table absente (migration pas encore poussée) ou erreur : aucune favorite, la liste s'affiche quand même.
 */
async function loadFavoriteCampaignIds(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_campaign_favorites')
    .select('campaign_id')
    .eq('account_id', accountId);

  if (error) {
    console.error('lm_campaign_favorites', error.message);
    return new Set<string>();
  }

  return new Set(data.map((row) => row.campaign_id));
}

async function loadCampaignProspectCounts(client: Client, accountId: string) {
  const { data, error } = await client.rpc('lm_campaign_prospect_counts', {
    p_account_id: accountId,
  });

  if (error) {
    console.error('lm_campaign_prospect_counts', error);
    return null;
  }

  return new Map(data.map((row) => [row.campaign_id, row.prospects]));
}

/** Une campagne (null si absente ou hors de l'organisation, grâce au RLS). */
export async function loadCampaign(client: Client, campaignId: string) {
  const { data, error } = await client
    .from('lm_campaigns')
    .select(
      'id, account_id, space_id, name, status, country_code, created_at, templates, auto_validation, daily_limit, sender_id, sort_target, sort_version',
    )
    .eq('id', campaignId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Une campagne avec son ciblage complet pour le formulaire de modification :
 * les villes et activités référencées par identifiant sont résolues en
 * libellés. `launched` = des zones existent (la campagne a déjà été lancée).
 */
export async function loadCampaignForEdit(
  client: Client,
  campaignId: string,
  locale: string,
  /** déjà connu de l'appelant (nombre de zones > 0) : évite de recompter les zones (16 000 pour une campagne France) */
  knownLaunched?: boolean,
) {
  const [{ data, error }, zones] = await Promise.all([
    client
      .from('lm_campaigns')
      .select(
        'id, account_id, space_id, name, status, country_code, targeting, filters, sort_target, offer, max_kept, max_credits',
      )
      .eq('id', campaignId)
      .maybeSingle(),
    // « déjà lancée » = des zones existent ; seulement si l'appelant ne le sait pas déjà
    knownLaunched === undefined
      ? client
          .from('lm_campaign_zones')
          .select('campaign_id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .limit(1)
      : Promise.resolve({ count: null, error: null }),
  ]);

  if (zones.error) {
    throw zones.error;
  }

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const targeting = (data.targeting ?? {}) as {
    cities?: { geoname_ids?: number[]; geoname_id?: number };
    categories?: { gcids?: string[] };
  };

  const geonameIds = [
    ...(targeting.cities?.geoname_ids ?? []),
    ...(targeting.cities?.geoname_id ? [targeting.cities.geoname_id] : []),
  ];

  const gcids = targeting.categories?.gcids ?? [];

  const [cities, categories] = await Promise.all([
    geonameIds.length
      ? client
          .from('lm_geo_cities')
          .select('geoname_id, name, population')
          .in('geoname_id', geonameIds)
      : Promise.resolve({ data: [], error: null }),
    loadCategoriesByGcid(client, gcids),
  ]);

  if (cities.error) throw cities.error;
  if (categories.error) throw categories.error;

  // on garde l'ordre choisi par l'utilisateur
  const cityById = new Map(
    (cities.data ?? []).map((city) => [
      city.geoname_id,
      {
        geonameId: city.geoname_id,
        name: city.name,
        population: city.population,
      },
    ]),
  );

  const categoryById = new Map(
    (categories.data ?? []).map((category) => [
      category.gcid,
      {
        gcid: category.gcid,
        label: locale.startsWith('fr') ? category.label_fr : category.label_en,
        family: category.family,
      },
    ]),
  );

  return {
    ...data,
    launched: knownLaunched ?? (zones.count ?? 0) > 0,
    cities: geonameIds.flatMap((id) => cityById.get(id) ?? []),
    categories: gcids.flatMap((gcid) => categoryById.get(gcid) ?? []),
  };
}

/**
 * « Votre offre » de chaque dossier de l'organisation (lm_spaces.offer, écran « Qui ? »). En cas d'erreur de
 * lecture, aucune offre : le formulaire la demande, sans casser la page.
 */
export async function loadSpaceOffers(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_spaces')
    .select('id, offer')
    .eq('account_id', accountId);

  if (error) {
    return {} as Record<string, string>;
  }

  return Object.fromEntries(
    (data ?? []).map((space) => [space.id, space.offer ?? '']),
  ) as Record<string, string>;
}

/** Activités par requête : la liste va dans l'adresse de la requête, qui doit rester courte. */
const GCID_CHUNK = 200;

/**
 * Libellés des activités choisies, par paquets de GCID_CHUNK : une campagne
 * peut en compter des milliers (« Tout sélectionner », utilisateurs sans
 * limite), trop pour une seule requête.
 */
async function loadCategoriesByGcid(client: Client, gcids: string[]) {
  const chunks: string[][] = [];

  for (let i = 0; i < gcids.length; i += GCID_CHUNK) {
    chunks.push(gcids.slice(i, i + GCID_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      client
        .from('lm_categories')
        .select('gcid, label_fr, label_en, family')
        .in('gcid', chunk),
    ),
  );

  const failed = results.find((result) => result.error);

  if (failed?.error) {
    return { data: null, error: failed.error };
  }

  return { data: results.flatMap((result) => result.data ?? []), error: null };
}

/**
 * Trois prospects récents de l'espace (avec site web) pour l'aperçu des
 * messages. Null-safe : un espace vide renvoie une liste vide.
 */
export async function loadPreviewProspects(client: Client, spaceId: string) {
  const { data, error } = await client
    .from('lm_prospects')
    .select('id, name, city, category, rating, review_count, website')
    .eq('space_id', spaceId)
    .is('excluded_at', null)
    .not('website', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3);

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Aperçu de « Un message par groupe » : quelques entreprises gardées de chaque groupe, en UNE requête (avant,
 * une par groupe : 20 requêtes pour 20 groupes fins). Renvoie { clé du groupe: entreprises }.
 */
export async function loadKeptPreviewByGroup(
  client: Client,
  campaignId: string,
  version: number,
  groupKeys: string[],
  perGroup = 5,
) {
  const { data, error } = await client
    .from('lm_campaign_prospects')
    .select(
      'group_key, prospect:lm_prospects(id, name, city, category, rating, review_count, website)',
    )
    .eq('campaign_id', campaignId)
    .or(keptCompaniesFilter(version))
    .in('group_key', groupKeys)
    .order('sorted_at', { ascending: false, nullsFirst: false })
    .order('prospect_id', { ascending: true })
    .limit(Math.min(1000, groupKeys.length * perGroup * 10));

  if (error) {
    throw error;
  }

  const byGroup: Record<
    string,
    NonNullable<(typeof data)[number]['prospect']>[]
  > = {};

  for (const row of data ?? []) {
    if (!row.group_key || !row.prospect) continue;

    const list = (byGroup[row.group_key] ??= []);

    if (list.length < perGroup) {
      list.push(row.prospect);
    }
  }

  return byGroup;
}

/**
 * Aperçu de « Votre message » pour une campagne triée : jusqu'à `limit` entreprises gardées (pour la cible en cours
 * `version`, ou gardées par le client), les plus récemment triées d'abord, avec ce qu'il faut pour remplacer les
 * variables. `groupKey` : seulement celles de ce groupe (onglets de « Un message par groupe »). Liste vide tant
 * qu'aucune entreprise n'est gardée.
 */
export async function loadKeptPreviewProspects(
  client: Client,
  campaignId: string,
  version: number,
  options: { groupKey?: string; limit?: number } = {},
) {
  let query = client
    .from('lm_campaign_prospects')
    .select(
      'prospect:lm_prospects(id, name, city, category, rating, review_count, website)',
    )
    .eq('campaign_id', campaignId)
    .or(keptCompaniesFilter(version));

  if (options.groupKey !== undefined) {
    query = query.eq('group_key', options.groupKey);
  }

  const { data, error } = await query
    .order('sorted_at', { ascending: false, nullsFirst: false })
    .order('prospect_id', { ascending: true })
    .limit(options.limit ?? 20);

  if (error) {
    throw error;
  }

  return (data ?? []).flatMap((row) => (row.prospect ? [row.prospect] : []));
}

/**
 * Recherche sur l'ordinateur dédié : l'utilisateur peut-il basculer la
 * campagne, est-elle basculée, dernier signe de vie du robot de l'ordinateur.
 * Ne fait jamais échouer la page (null en cas d'erreur).
 */
export async function loadLocalDiscoveryState(
  client: Client,
  campaignId: string,
) {
  const { data, error } = await client.rpc('lm_local_discovery_state', {
    p_campaign_id: campaignId,
  });

  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const state = data as {
    allowed?: boolean;
    enabled?: boolean;
    minutes_ago?: number | null;
  };

  return {
    allowed: state.allowed === true,
    enabled: state.enabled === true,
    /** minutes depuis le dernier signe de vie du robot (null : jamais vu) */
    minutesAgo:
      typeof state.minutes_ago === 'number' ? state.minutes_ago : null,
  };
}

/** Le forfait de l'organisation inclut-il la validation automatique des formulaires ? */
export async function loadAutoValidationAllowed(
  client: Client,
  accountId: string,
) {
  const { data, error } = await client.rpc('lm_auto_validation_allowed', {
    p_account_id: accountId,
  });

  if (error) {
    throw error;
  }

  return data === true;
}
