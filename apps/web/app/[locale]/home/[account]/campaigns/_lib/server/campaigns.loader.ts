import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

/** Campagnes de l'organisation, avec leur dossier client et le nombre de prospects trouvés. */
export async function loadCampaigns(client: Client, accountId: string) {
  const { data, error } = await client
    .from('lm_campaigns')
    .select(
      'id, name, status, country_code, created_at, space_id, prospects:lm_prospects(count)',
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

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
    prospects: campaign.prospects?.[0]?.count ?? 0,
  }));
}

/** Une campagne (null si absente ou hors de l'organisation, grâce au RLS). */
export async function loadCampaign(client: Client, campaignId: string) {
  const { data, error } = await client
    .from('lm_campaigns')
    .select(
      'id, account_id, space_id, name, status, country_code, created_at, templates, auto_validation, daily_limit',
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
) {
  const { data, error } = await client
    .from('lm_campaigns')
    .select(
      'id, account_id, space_id, name, status, country_code, targeting, filters, zones:lm_campaign_zones(count)',
    )
    .eq('id', campaignId)
    .maybeSingle();

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
    gcids.length
      ? client
          .from('lm_categories')
          .select('gcid, label_fr, label_en, family')
          .in('gcid', gcids)
      : Promise.resolve({ data: [], error: null }),
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
    launched: (data.zones?.[0]?.count ?? 0) > 0,
    cities: geonameIds.flatMap((id) => cityById.get(id) ?? []),
    categories: gcids.flatMap((gcid) => categoryById.get(gcid) ?? []),
  };
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
