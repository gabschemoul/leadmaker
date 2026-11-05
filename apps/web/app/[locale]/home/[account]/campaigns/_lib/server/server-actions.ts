'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { mentionsCompany, unknownVariables } from '~/lib/leadmaker/templates';
import {
  ESTIMATE_ERRORS,
  PREPARE_ERRORS,
  throwRpcError,
} from '~/lib/server/leadmaker/rpc-errors';

import {
  RequestEstimateSchema,
  CampaignIdSchema,
  CampaignSenderSchema,
  CreateCampaignSchema,
  DuplicateCampaignSchema,
  EstimateCampaignSchema,
  FamilyCategoriesSchema,
  LocalDiscoverySchema,
  MAX_CATEGORIES,
  NearbyCitiesSchema,
  SearchCategoriesSchema,
  SearchCitiesSchema,
  UpdateCampaignSchema,
  buildFilters,
  buildTargeting,
} from '../schema/campaign.schema';
import { SaveCampaignTemplatesSchema } from '../schema/templates.schema';
import { getCategoryLimit, isPowerUser } from './power-user';

/** Échappe les jokers de LIKE (% et _) saisis par l'utilisateur. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function stripAccents(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Texte de recherche d'activité : minuscules, sans accents, œ/æ développés,
 * apostrophes (’ ou ') et tirets remplacés par des espaces. Même règle que la
 * colonne lm_categories.search_key (27-leadmaker-discovery.sql).
 */
function foldSearch(value: string) {
  return stripAccents(value.toLowerCase())
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/[’‘`´'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

/**
 * Familles d'activités (catalogue Google, 25 familles) avec leur nombre
 * d'activités, pour parcourir les activités sans connaître leur nom exact.
 */
export const listCategoryFamiliesAction = authActionClient.action(async () => {
  const { data, error } = await loadCatalog(getSupabaseServerClient());

  if (error) {
    const logger = await getLogger();
    logger.error(
      { name: 'leadmaker.categories.families', error },
      'Category families failed',
    );

    throw new Error('campaigns.errors.searchFailed');
  }

  const counts = new Map<string, number>();

  for (const row of data ?? []) {
    counts.set(row.family, (counts.get(row.family) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => a.family.localeCompare(b.family, 'fr'));
});

/** Lignes par requête : l'API de la base n'en renvoie pas plus (max_rows). */
const CATALOG_PAGE = 1000;

/**
 * Tout le catalogue d'activités (hors activités exclues), lu par pages de
 * CATALOG_PAGE : une seule requête s'arrêtait aux 1 000 premières des ~3 900.
 */
async function loadCatalog(client: ReturnType<typeof getSupabaseServerClient>) {
  const rows: {
    gcid: string;
    label_fr: string;
    label_en: string;
    family: string;
  }[] = [];

  // 20 pages au plus : garde-fou si le catalogue grossissait démesurément
  for (let page = 0; page < 20; page++) {
    const { data, error } = await client
      .from('lm_categories')
      .select('gcid, label_fr, label_en, family')
      .eq('is_excluded', false)
      .order('gcid', { ascending: true })
      .range(page * CATALOG_PAGE, (page + 1) * CATALOG_PAGE - 1);

    if (error) {
      return { data: null, error };
    }

    rows.push(...data);

    if (data.length < CATALOG_PAGE) {
      break;
    }
  }

  return { data: rows, error: null };
}

/**
 * Toutes les activités du catalogue, pour « Tout sélectionner » (utilisateurs
 * sans limite d'activités seulement : sinon la sélection dépasserait la limite).
 */
export const listAllCategoriesAction = authActionClient.action(
  async ({ ctx }) => {
    const [limit, catalog] = await Promise.all([
      getCategoryLimit(ctx.user.id),
      loadCatalog(getSupabaseServerClient()),
    ]);

    if (catalog.error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.categories.all', error: catalog.error },
        'All categories failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    if (catalog.data.length > limit) {
      throw new Error('campaigns.errors.tooManyCategories');
    }

    return catalog.data.map((category) => ({
      gcid: category.gcid,
      labelFr: category.label_fr,
      labelEn: category.label_en,
      family: category.family,
    }));
  },
);

/** Les activités d'une famille : les plus courantes d'abord, puis par ordre alphabétique. */
export const listFamilyCategoriesAction = authActionClient
  .inputSchema(FamilyCategoriesSchema)
  .action(async ({ parsedInput: { family } }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('lm_categories')
      .select('gcid, label_fr, label_en, family, is_generic')
      .eq('is_excluded', false)
      .eq('family', family)
      .order('is_generic', { ascending: false })
      .order('label_fr', { ascending: true })
      .limit(1000);

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.categories.family', error },
        'Family categories failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    return (data ?? []).map((category) => ({
      gcid: category.gcid,
      labelFr: category.label_fr,
      labelEn: category.label_en,
      family: category.family,
      common: category.is_generic,
    }));
  });

/** Autocomplétion des catégories Google (libellé français ou anglais). */
export const searchCategoriesAction = authActionClient
  .inputSchema(SearchCategoriesSchema)
  .action(async ({ parsedInput: { query } }) => {
    const client = getSupabaseServerClient();

    // Mots tapés, sans accents ni apostrophes ni tirets (comme search_key en
    // base), et sans jokers LIKE ni caractères de syntaxe PostgREST. Chaque
    // mot doit apparaître, dans n'importe quel ordre.
    const words = foldSearch(query)
      .replace(/[,()"*:\\%_.]/g, ' ')
      .split(' ')
      .filter(Boolean)
      .slice(0, 6);

    if (words.length === 0) {
      return [];
    }

    let request = client
      .from('lm_categories')
      .select('gcid, label_fr, label_en, family')
      .eq('is_excluded', false);

    for (const word of words) {
      request = request.ilike('search_key', `%${word}%`);
    }

    const { data, error } = await request
      .order('is_generic', { ascending: false })
      .order('label_fr', { ascending: true })
      .limit(30);

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.categories.search', error },
        'Category search failed',
      );

      throw new Error('campaigns.errors.searchFailed');
    }

    return (data ?? []).map((category) => ({
      gcid: category.gcid,
      labelFr: category.label_fr,
      labelEn: category.label_en,
      family: category.family,
    }));
  });

/** Estimation avant lancement : villes, recherches et prospects attendus. */
export const estimateCampaignAction = authActionClient
  .inputSchema(EstimateCampaignSchema)
  .action(async ({ parsedInput: { countryCode, targeting, filters } }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_estimate_campaign', {
      p_country_code: countryCode,
      p_targeting: targeting,
      p_filters: filters ?? {},
    });

    if (error) {
      const logger = await getLogger();
      logger.error(
        { name: 'leadmaker.campaigns.estimate', error },
        'Campaign estimate failed',
      );

      throw new Error('campaigns.errors.estimateFailed');
    }

    const row = data?.[0];

    return {
      cities: row?.cities ?? 0,
      categories: row?.categories ?? 0,
      searches: row?.searches ?? 0,
      expectedProspects: row?.expected_prospects ?? 0,
    };
  });

/** Enregistre la campagne en brouillon puis ouvre sa page. */
/**
 * Estimation réelle : le worker lit Google Maps (sans ouvrir les fiches, sans crédit)
 * et compte les entreprises qui passent les filtres. Renvoie l'identifiant à suivre.
 */
export const requestEstimateAction = authActionClient
  .inputSchema(RequestEstimateSchema)
  .action(
    async ({ parsedInput: { accountId, countryCode, targeting, filters } }) => {
      const client = getSupabaseServerClient();

      const { data, error } = await client.rpc('lm_request_estimate', {
        p_account_id: accountId,
        p_country_code: countryCode,
        p_targeting: targeting,
        p_filters: filters,
      });

      if (error) {
        await throwRpcError({
          scope: 'campaigns.real-estimate',
          error,
          hints: ESTIMATE_ERRORS,
          fallback: 'campaigns.errors.estimateFailed',
          context: { accountId },
        });
      }

      if (!data) {
        throw new Error('campaigns.errors.estimateFailed');
      }

      return { estimateId: data };
    },
  );

/** Plus d'activités que la limite de l'utilisateur (1 000, sauf Gabriel et Nath) : refusé. */
async function assertCategoryLimit(count: number, userId: string) {
  if (count > MAX_CATEGORIES && count > (await getCategoryLimit(userId))) {
    throw new Error('campaigns.errors.tooManyCategories');
  }
}

export const createCampaignAction = authActionClient
  .inputSchema(CreateCampaignSchema)
  .action(async ({ parsedInput: values, ctx }) => {
    await assertCategoryLimit(values.categories.length, ctx.user.id);

    const targeting = buildTargeting(values);

    if (!targeting) {
      throw new Error('campaigns.errors.targetingIncomplete');
    }

    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('lm_campaigns')
      .insert({
        account_id: values.accountId,
        space_id: values.spaceId,
        name: values.name,
        country_code: values.countryCode,
        targeting,
        filters: buildFilters(values),
      })
      .select('id')
      .single();

    if (error || !data) {
      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.create',
          accountId: values.accountId,
          userId: ctx.user.id,
          error,
        },
        'Failed to create campaign',
      );

      throw new Error('campaigns.errors.createFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'page');

    redirect(`/home/${values.accountSlug}/campaigns/${data.id}`);
  });

/**
 * Modifie une campagne, même lancée : les villes et activités ajoutées
 * rejoignent la file de scan, celles retirées sont sautées. Une campagne
 * terminée qui reçoit du travail est relancée.
 */
export const updateCampaignAction = authActionClient
  .inputSchema(UpdateCampaignSchema)
  .action(async ({ parsedInput: values, ctx }) => {
    await assertCategoryLimit(values.categories.length, ctx.user.id);

    const targeting = buildTargeting(values);

    if (!targeting) {
      throw new Error('campaigns.errors.targetingIncomplete');
    }

    const client = getSupabaseServerClient();

    // statut AVANT la modification : seule une campagne terminée est relancée
    // d'office ; une campagne mise en pause par l'utilisateur reste en pause
    const { data: before } = await client
      .from('lm_campaigns')
      .select('status')
      .eq('id', values.campaignId)
      .maybeSingle();

    const { data: status, error } = await client.rpc('lm_update_campaign', {
      p_campaign_id: values.campaignId,
      p_name: values.name,
      p_country_code: values.countryCode,
      p_targeting: targeting,
      p_filters: buildFilters(values),
    });

    if (error) {
      if (error.hint === 'country_locked') {
        throw new Error('campaigns.errors.countryLocked');
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.update',
          campaignId: values.campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to update campaign',
      );

      throw new Error('campaigns.errors.updateFailed');
    }

    // Terminée puis complétée : on la relance tout de suite. Si la reprise est
    // refusée (crédits, forfait), la campagne reste en pause avec « Reprendre ».
    // Une campagne déjà en pause avant la modification n'est jamais relancée.
    if (before?.status === 'completed' && status === 'paused') {
      await client.rpc('lm_start_campaign', {
        p_campaign_id: values.campaignId,
      });
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    redirect(`/home/${values.accountSlug}/campaigns/${values.campaignId}`);
  });

/** Copie une campagne en brouillon et ouvre le formulaire de la copie. */
export const duplicateCampaignAction = authActionClient
  .inputSchema(DuplicateCampaignSchema)
  .action(async ({ parsedInput: { campaignId, accountSlug, name }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data: id, error } = await client.rpc('lm_duplicate_campaign', {
      p_campaign_id: campaignId,
      p_name: name,
    });

    if (error || !id) {
      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.duplicate',
          campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to duplicate campaign',
      );

      throw new Error('campaigns.errors.duplicateFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    redirect(`/home/${accountSlug}/campaigns/${id}/edit`);
  });

const START_ERRORS: Record<string, string> = {
  no_credits: 'campaigns.errors.noCredits',
  campaign_limit: 'campaigns.errors.campaignLimit',
  no_cities: 'campaigns.errors.noCities',
};

/**
 * Lance ou reprend une campagne, tout de suite (4/11/2026) : sans estimation terminée, la mesure de la
 * difficulté tourne en parallèle et fixe le tarif quand elle se termine (lm_start_campaign).
 */
export const startCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_start_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      const known = error.hint ? START_ERRORS[error.hint] : undefined;

      if (known) {
        throw new Error(known);
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.start',
          campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to start campaign',
      );

      throw new Error('campaigns.errors.startFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/** Met une campagne en pause. */
export const pauseCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_pause_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.pause',
          campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to pause campaign',
      );

      throw new Error('campaigns.errors.pauseFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/**
 * Fait chercher la campagne sur l'ordinateur dédié (sans proxy) ou la remet
 * sur les serveurs. Réservé aux utilisateurs listés en base (contrôlé par
 * lm_set_local_discovery).
 */
export const setLocalDiscoveryAction = authActionClient
  .inputSchema(LocalDiscoverySchema)
  .action(async ({ parsedInput: { campaignId, enabled }, ctx }) => {
    const client = getSupabaseServerClient();

    const { error } = await client.rpc('lm_set_local_discovery', {
      p_campaign_id: campaignId,
      p_enabled: enabled,
    });

    if (error) {
      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.localDiscovery',
          campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to switch local discovery',
      );

      throw new Error('campaigns.localDiscovery.failed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { enabled };
  });

/**
 * Choisit l'expéditeur d'une campagne (null = celui par défaut). La base
 * refuse un expéditeur d'un autre espace (lm_campaigns_check_sender) et le
 * RLS une campagne d'une autre organisation.
 */
export const setCampaignSenderAction = authActionClient
  .inputSchema(CampaignSenderSchema)
  .action(async ({ parsedInput: { campaignId, senderId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('lm_campaigns')
      .update({ sender_id: senderId })
      .eq('id', campaignId)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      if (!error || error.code === '23514' || error.code === '42501') {
        throw new Error('campaigns.steps.write.senderNotFound');
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.sender',
          campaignId,
          senderId,
          userId: ctx.user.id,
          error,
        },
        'Failed to set campaign sender',
      );

      throw new Error('campaigns.steps.write.senderChooseFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true };
  });

/**
 * Enregistre les messages d'une campagne. Contrôle bloquant : chaque message
 * rempli doit mentionner la société de l'expéditeur (variable {my_company} ou
 * nom en clair), pour que l'entreprise contactée sache qui lui écrit. Les
 * utilisateurs sans limite (Gabriel et Nath, power-user.ts) en sont dispensés.
 */
export const saveCampaignTemplatesAction = authActionClient
  .inputSchema(SaveCampaignTemplatesSchema)
  .action(async ({ parsedInput, ctx }) => {
    const client = getSupabaseServerClient();

    const campaign = await client
      .from('lm_campaigns')
      .select('id, space_id')
      .eq('id', parsedInput.campaignId)
      .maybeSingle();

    if (campaign.error) throw campaign.error;

    if (!campaign.data) {
      throw new Error('outreach.messages.campaignNotFound');
    }

    const [sender, companyOptional] = await Promise.all([
      // expéditeur de la campagne (choisi pour elle, sinon celui par défaut)
      client
        .rpc('lm_campaign_sender', { p_campaign_id: campaign.data.id })
        .select('company')
        .maybeSingle(),
      isPowerUser(ctx.user.id),
    ]);

    if (sender.error) throw sender.error;

    // seuls les messages remplis sont conservés ; les cases vides sont ignorées
    const messages = parsedInput.messages
      .map((message, index) => ({
        name: message.name || `Message ${index + 1}`,
        subject: message.subject,
        body: message.body,
        short: message.body.trim() ? message.short : '',
      }))
      .filter((message) => message.body.trim() !== '');

    const filled = messages.flatMap((message) => [
      message,
      ...(message.short.trim()
        ? [{ subject: message.subject, body: message.short }]
        : []),
    ]);

    for (const message of filled) {
      if (unknownVariables(`${message.subject} ${message.body}`).length > 0) {
        throw new Error('outreach.messages.unknownVariable');
      }

      if (
        !companyOptional &&
        !mentionsCompany(message.body, sender.data?.company ?? null)
      ) {
        throw new Error('outreach.messages.companyMissing');
      }
    }

    const { error } = await client
      .from('lm_campaigns')
      .update({
        templates: { messages },
        daily_limit: parsedInput.dailyLimit,
        auto_validation: parsedInput.autoValidation,
      })
      .eq('id', parsedInput.campaignId);

    if (error) {
      // validation automatique hors forfait (contrôle du déclencheur SQL)
      if (error.hint === 'plan') {
        throw new Error('outreach.messages.autoValidationPlan');
      }

      const logger = await getLogger();
      logger.error(
        {
          name: 'leadmaker.campaigns.templates',
          campaignId: parsedInput.campaignId,
          userId: ctx.user.id,
          error,
        },
        'Failed to save campaign templates',
      );

      throw new Error('outreach.messages.saveFailed');
    }

    revalidatePath('/home/[account]/campaigns', 'layout');

    return { success: true, count: filled.length };
  });

/** Prépare les formulaires de tous les prospects d'une campagne pas encore traités. */
export const prepareCampaignAction = authActionClient
  .inputSchema(CampaignIdSchema)
  .action(async ({ parsedInput: { campaignId }, ctx }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('lm_prepare_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      await throwRpcError({
        scope: 'campaigns.prepare',
        error,
        hints: PREPARE_ERRORS,
        fallback: 'outreach.forms.prepare.failed',
        context: { campaignId, userId: ctx.user.id },
      });
    }

    revalidatePath('/home/[account]/forms', 'page');

    return { queued: data?.[0]?.queued ?? 0, skipped: data?.[0]?.skipped ?? 0 };
  });
