'use server';

/**
 * Rôle : actions serveur de la zone ciblée (autocomplétion des villes, « une ville et ses alentours »).
 * Données : lecture de lm_geo_cities (client Supabase de l'utilisateur, RLS).
 * Écritures : aucune.
 */
import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  NearbyCitiesSchema,
  SearchCitiesSchema,
} from '../schema/campaign.schema';
import { escapeLike, stripAccents } from './search-text';

/**
 * Autocomplétion des villes d'un pays, par début de nom (sans accents), des
 * plus peuplées aux moins peuplées.
 */
export const searchCitiesAction = authActionClient
  .inputSchema(SearchCitiesSchema)
  .action(async ({ parsedInput: { countryCode, query } }) => {
    const client = getSupabaseServerClient();
    const prefix = escapeLike(stripAccents(query));

    const { data, error } = await client
      .from('lm_geo_cities')
      .select('geoname_id, name, population')
      .eq('country_code', countryCode)
      .ilike('ascii_name', `${prefix}%`)
      .order('population', { ascending: false })
      .limit(20);

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.cities.search', error },
        'City search failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    return (data ?? []).map((city) => ({
      geonameId: city.geoname_id,
      name: city.name,
      population: city.population,
    }));
  });

/** Distance à vol d'oiseau entre deux points, en km (formule de haversine). */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * « Une ville et ses alentours » : toutes les villes du pays à moins de
 * `radiusKm` de la ville centre, de la plus proche à la plus lointaine.
 * Les arrondissements (« Lyon 03 », « Paris 15 ») sont signalés : la ville
 * mère est déjà quadrillée, les scanner en plus ferait doublon.
 */
export const nearbyCitiesAction = authActionClient
  .inputSchema(NearbyCitiesSchema)
  .action(
    async ({
      parsedInput: { countryCode, geonameId, radiusKm, minPopulation },
    }) => {
      const client = getSupabaseServerClient();
      const logger = await getLogger();

      const { data: center, error: centerError } = await client
        .from('lm_geo_cities')
        .select('geoname_id, name, population, latitude, longitude')
        .eq('geoname_id', geonameId)
        .eq('country_code', countryCode)
        .maybeSingle();

      if (centerError || !center) {
        logger.error(
          { name: 'leadmaker.cities.nearby', error: centerError, geonameId },
          'Nearby cities: center not found',
        );

        throw new Error('campaigns.errors.searchFailed');
      }

      const latDelta = radiusKm / 111;
      const lngDelta =
        radiusKm /
        (111 * Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.01));

      const { data, error } = await client
        .from('lm_geo_cities')
        .select('geoname_id, name, population, latitude, longitude')
        .eq('country_code', countryCode)
        .gte('population', minPopulation)
        .gte('latitude', center.latitude - latDelta)
        .lte('latitude', center.latitude + latDelta)
        .gte('longitude', center.longitude - lngDelta)
        .lte('longitude', center.longitude + lngDelta)
        .limit(5000);

      if (error) {
        logger.error(
          { name: 'leadmaker.cities.nearby', error },
          'Nearby cities search failed',
        );

        throw new Error('campaigns.errors.searchFailed');
      }

      const rows = (data ?? [])
        .map((city) => ({
          city,
          km: distanceKm(
            center.latitude,
            center.longitude,
            city.latitude,
            city.longitude,
          ),
        }))
        .filter(
          ({ city, km }) => km <= radiusKm || city.geoname_id === geonameId,
        );

      const names = new Set(rows.map(({ city }) => city.name.toLowerCase()));

      return rows
        .map(({ city, km }) => {
          const parent = city.name.match(/^(.+?)\s+\d{1,2}(?:e|er)?$/i)?.[1];

          return {
            geonameId: city.geoname_id,
            name: city.name,
            population: city.population,
            distanceKm: Math.round(km * 10) / 10,
            // « Lyon 03 » quand « Lyon » est aussi dans la liste
            districtOf:
              parent && names.has(parent.toLowerCase()) ? parent : null,
          };
        })
        .sort(
          (a, b) =>
            a.distanceKm - b.distanceKm ||
            (b.population ?? 0) - (a.population ?? 0),
        );
    },
  );
