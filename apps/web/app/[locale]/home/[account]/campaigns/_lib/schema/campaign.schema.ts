import * as z from 'zod';

/**
 * Formulaire de campagne et conversion vers les colonnes jsonb `targeting`
 * et `filters` de lm_campaigns (format décrit dans
 * supabase/schemas/27-leadmaker-discovery.sql).
 */

const NUMBER_INVALID = 'campaigns.form.numberInvalid';
const NUMBER_RANGE = 'campaigns.form.numberOutOfRange';

const integer = (min: number, max: number) =>
  z
    .number({ error: NUMBER_INVALID })
    .int({ error: NUMBER_INVALID })
    .min(min, { error: NUMBER_RANGE })
    .max(max, { error: NUMBER_RANGE });

// La note Google va de 1 à 5 : jamais de note minimale sous 1 (demande de
// Gabriel, 2/11/2026). Le robot exclut déjà les fiches sans note dès que la
// note minimale dépasse 0, donc 0,8 et 1 donnaient le même résultat.
export const RATING_FLOOR = 1;

const rating = () =>
  z
    .number({ error: NUMBER_INVALID })
    .min(RATING_FLOOR, { error: 'campaigns.form.ratingOutOfRange' })
    .max(5, { error: 'campaigns.form.ratingOutOfRange' });

const decimal = (min: number, max: number) =>
  z
    .number({ error: NUMBER_INVALID })
    .min(min, { error: NUMBER_RANGE })
    .max(max, { error: NUMBER_RANGE });

export const CityRefSchema = z.object({
  geonameId: z.number().int(),
  name: z.string().max(200),
  population: z.number().int().optional(),
});

export const CategoryRefSchema = z.object({
  gcid: z.string().min(1).max(200),
  label: z.string().max(300),
  family: z.string().max(300).optional(),
});

export type CityRef = z.infer<typeof CityRefSchema>;
export type CategoryRef = z.infer<typeof CategoryRefSchema>;

export const MAX_CITIES_LIMIT = 20000;

/** Villes au plus dans le mode « Villes précises ». */
export const MAX_LIST_CITIES = 1000;

const CampaignFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'campaigns.form.nameRequired' })
    .max(255, { error: 'campaigns.form.nameTooLong' }),
  spaceId: z.string().min(1, { error: 'campaigns.form.folderRequired' }),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, { error: 'campaigns.form.countryRequired' }),
  citiesMode: z.enum(['country', 'radius', 'list']),
  minPopulation: integer(0, 100_000_000),
  radiusCity: CityRefSchema.nullable(),
  radiusKm: decimal(1, 500),
  cities: z.array(CityRefSchema).max(MAX_LIST_CITIES),
  maxCities: integer(1, MAX_CITIES_LIMIT),
  // Seul « Je choisis moi-même » est proposé (roadmap n°10, 2/11/2026) :
  // « Toutes les activités » faisait essayer des milliers d'activités sans
  // prospect avant de creuser les bonnes. Les anciennes campagnes gardent
  // leur mode en base (TargetingSchema) mais repassent par une liste ici.
  categoriesMode: z.literal('list'),
  categories: z.array(CategoryRefSchema).max(1000),
  ratingMin: rating(),
  ratingMax: rating(),
  minReviews: integer(0, 1_000_000),
  website: z.enum(['with', 'without', 'all']),
  excludePublic: z.boolean(),
  mainCategoryOnly: z.boolean(),
  extraExclusions: z.string().max(2000),
});

type CampaignFields = z.infer<typeof CampaignFieldsSchema>;

function refineCampaign(values: CampaignFields, ctx: z.RefinementCtx) {
  if (values.citiesMode === 'radius' && !values.radiusCity) {
    ctx.addIssue({
      code: 'custom',
      path: ['radiusCity'],
      message: 'campaigns.form.radiusCityRequired',
    });
  }

  if (values.citiesMode === 'list' && values.cities.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['cities'],
      message: 'campaigns.form.citiesRequired',
    });
  }

  if (values.categories.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['categories'],
      message: 'campaigns.form.categoriesRequired',
    });
  }

  if (values.ratingMin > values.ratingMax) {
    ctx.addIssue({
      code: 'custom',
      path: ['ratingMax'],
      message: 'campaigns.form.ratingRange',
    });
  }
}

export const CampaignFormSchema =
  CampaignFieldsSchema.superRefine(refineCampaign);

export type CampaignFormValues = z.infer<typeof CampaignFormSchema>;

export const CreateCampaignSchema = CampaignFieldsSchema.extend({
  accountId: z.string().uuid(),
  accountSlug: z.string().min(1),
}).superRefine(refineCampaign);

export const UpdateCampaignSchema = CampaignFieldsSchema.extend({
  campaignId: z.string().uuid(),
  accountSlug: z.string().min(1),
}).superRefine(refineCampaign);

export const TargetingSchema = z.object({
  cities: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('country'),
      min_population: z.number().int().min(0),
      max_population: z.number().int().min(0).nullable(),
    }),
    z.object({
      mode: z.literal('list'),
      geoname_ids: z.array(z.number().int()).max(1000),
    }),
    z.object({
      mode: z.literal('radius'),
      geoname_id: z.number().int(),
      radius_km: z.number().min(1).max(500),
      min_population: z.number().int().min(0),
    }),
  ]),
  categories: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('generic') }),
    z.object({ mode: z.literal('all') }),
    z.object({
      mode: z.literal('list'),
      gcids: z.array(z.string().min(1)).max(1000),
    }),
  ]),
  max_cities: z.number().int().min(1).max(MAX_CITIES_LIMIT).optional(),
});

export type Targeting = z.infer<typeof TargetingSchema>;

type TargetingInput = Pick<
  CampaignFields,
  | 'citiesMode'
  | 'minPopulation'
  | 'radiusCity'
  | 'radiusKm'
  | 'cities'
  | 'maxCities'
  | 'categoriesMode'
  | 'categories'
>;

/** Renvoie `null` tant que le ciblage est incomplet (ville ou liste manquante). */
export function buildTargeting(values: TargetingInput): Targeting | null {
  const maxCities = Number.isFinite(values.maxCities) ? values.maxCities : 5000;
  let cities: Targeting['cities'];

  if (values.citiesMode === 'radius') {
    if (!values.radiusCity || !Number.isFinite(values.radiusKm)) {
      return null;
    }

    cities = {
      mode: 'radius',
      geoname_id: values.radiusCity.geonameId,
      radius_km: values.radiusKm,
      min_population: 0,
    };
  } else if (values.citiesMode === 'list') {
    if (values.cities.length === 0) {
      return null;
    }

    cities = {
      mode: 'list',
      geoname_ids: values.cities.map((city) => city.geonameId),
    };
  } else {
    cities = {
      mode: 'country',
      min_population: Number.isFinite(values.minPopulation)
        ? values.minPopulation
        : 0,
      max_population: null,
    };
  }

  if (values.categories.length === 0) {
    return null;
  }

  const categories: Targeting['categories'] = {
    mode: 'list',
    gcids: values.categories.map((category) => category.gcid),
  };

  return { cities, categories, max_cities: maxCities };
}

export function buildFilters(
  values: Pick<
    CampaignFields,
    | 'ratingMin'
    | 'ratingMax'
    | 'minReviews'
    | 'website'
    | 'excludePublic'
    | 'mainCategoryOnly'
    | 'extraExclusions'
  >,
) {
  return {
    rating_min: values.ratingMin,
    rating_max: values.ratingMax,
    min_reviews: values.minReviews,
    website: values.website,
    exclude_public: values.excludePublic,
    main_category_only: values.mainCategoryOnly,
    extra_exclusions: values.extraExclusions
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean),
  };
}

export const EstimateFiltersSchema = z.object({
  rating_min: z.number().min(0).max(5),
  rating_max: z.number().min(0).max(5),
  min_reviews: z.number().int().min(0),
  website: z.enum(['with', 'without', 'all']),
});

export type EstimateFilters = z.infer<typeof EstimateFiltersSchema>;

export const EstimateCampaignSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  targeting: TargetingSchema,
  // facultatif : une page ouverte avant une mise à jour peut encore appeler l'estimation sans filtres
  filters: EstimateFiltersSchema.optional(),
});

export const RequestEstimateSchema = z.object({
  accountId: z.string().uuid(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  targeting: TargetingSchema,
  filters: EstimateFiltersSchema.extend({
    exclude_public: z.boolean(),
    main_category_only: z.boolean(),
    extra_exclusions: z.array(z.string()).max(200),
  }),
});

export const SearchCitiesSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  query: z.string().trim().min(1).max(100),
});

/** Villes à moins de `radiusKm` d'une ville centre (« Lyon et alentours »). */
export const NearbyCitiesSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  geonameId: z.number().int(),
  radiusKm: z.number().min(1).max(100),
  minPopulation: z.number().int().min(0).max(10_000_000),
});

/** Activités d'une famille (catalogue « Parcourir les activités »). */
export const FamilyCategoriesSchema = z.object({
  family: z.string().trim().min(1).max(200),
});

export const SearchCategoriesSchema = z.object({
  query: z.string().trim().min(1).max(100),
});

export const CampaignIdSchema = z.object({
  campaignId: z.string().uuid(),
});

/** Recherche Google Maps sur l'ordinateur dédié (utilisateurs autorisés seulement). */
export const LocalDiscoverySchema = CampaignIdSchema.extend({
  enabled: z.boolean(),
});

export const DuplicateCampaignSchema = CampaignIdSchema.extend({
  accountSlug: z.string().min(1),
  /** nom de la copie, traduit côté client (« X (copie) ») */
  name: z.string().trim().min(1).max(255),
});

/** Filtres tels qu'enregistrés en base (clés absentes = valeurs par défaut du formulaire). */
const StoredFiltersSchema = z
  .object({
    rating_min: z.number().optional(),
    rating_max: z.number().optional(),
    min_reviews: z.number().int().optional(),
    website: z.enum(['with', 'without', 'all']).optional(),
    exclude_public: z.boolean().optional(),
    main_category_only: z.boolean().optional(),
    extra_exclusions: z.array(z.string()).optional(),
  })
  .loose();

/**
 * Valeurs du formulaire d'une campagne existante. Les villes et activités sont
 * passées déjà résolues (nom, population, libellé) : la base ne stocke que
 * leurs identifiants.
 */
export function campaignToFormValues(campaign: {
  name: string;
  space_id: string;
  country_code: string;
  targeting: unknown;
  filters: unknown;
  cities: CityRef[];
  categories: CategoryRef[];
}): CampaignFormValues {
  const targeting = TargetingSchema.safeParse(campaign.targeting);
  const filters = StoredFiltersSchema.safeParse(campaign.filters);
  const cities = targeting.success ? targeting.data.cities : null;
  const categories = targeting.success ? targeting.data.categories : null;
  const f = filters.success ? filters.data : {};

  const radiusCity =
    cities?.mode === 'radius'
      ? (campaign.cities.find((city) => city.geonameId === cities.geoname_id) ??
        null)
      : null;

  return {
    name: campaign.name,
    spaceId: campaign.space_id,
    countryCode: campaign.country_code,
    citiesMode: cities?.mode ?? 'country',
    minPopulation: cities?.mode === 'country' ? cities.min_population : 0,
    radiusCity,
    radiusKm: cities?.mode === 'radius' ? cities.radius_km : 30,
    cities: cities?.mode === 'list' ? campaign.cities : [],
    maxCities: MAX_CITIES_LIMIT,
    categoriesMode: 'list',
    categories: categories?.mode === 'list' ? campaign.categories : [],
    ratingMin: Math.max(RATING_FLOOR, f.rating_min ?? RATING_FLOOR),
    ratingMax: f.rating_max ?? 3.5,
    minReviews: f.min_reviews ?? 1,
    website: f.website ?? 'with',
    excludePublic: f.exclude_public ?? true,
    mainCategoryOnly: f.main_category_only ?? true,
    extraExclusions: (f.extra_exclusions ?? []).join(', '),
  };
}
