'use client';

import { useMemo, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { ListTree, MapPin, X } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm, useWatch } from 'react-hook-form';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemLabel,
} from '@kit/ui/radio-group';
import { Trans } from '@kit/ui/trans';

import type { CountryOption } from '~/lib/leadmaker/countries';

import { CountrySelect } from '../../_components/leadmaker/country-select';
import {
  type CategoryRef,
  CampaignFormSchema,
  type CampaignFormValues,
  type CityRef,
  MAX_CITIES_LIMIT,
  MAX_LIST_CITIES,
  RATING_FLOOR,
  buildTargeting,
} from '../_lib/schema/campaign.schema';
import {
  createCampaignAction,
  searchCategoriesAction,
  searchCitiesAction,
  updateCampaignAction,
} from '../_lib/server/server-actions';
import { CampaignEstimate } from './campaign-estimate';
import { CategoryBrowserDialog } from './category-browser-dialog';
import { NearbyCitiesDialog } from './nearby-cities-dialog';
import { SearchPicker } from './search-picker';

interface SpaceOption {
  id: string;
  label: string;
  is_default: boolean;
}

export function CampaignForm(props: {
  accountId: string;
  accountSlug: string;
  spaces: SpaceOption[];
  countries: CountryOption[];
  discoveryBalance: number;
  /** campagne existante : le formulaire la modifie au lieu d'en créer une */
  campaign?: {
    id: string;
    values: CampaignFormValues;
    /** déjà lancée : le pays est figé, les villes ajoutées rejoignent le scan */
    launched: boolean;
  };
}) {
  const t = useTranslations('campaigns');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);

  const editing = Boolean(props.campaign);

  // Une seule entrée = l'espace par défaut : le choix du dossier client est masqué.
  const defaultSpace =
    props.spaces.find((space) => space.is_default) ?? props.spaces[0];

  const showSpaceSelect = props.spaces.length > 1;

  const create = useAction(createCampaignAction, {
    onExecute: () => setError(null),
    onError: ({ error }) => {
      setError(error.serverError ?? 'campaigns.errors.createFailed');
    },
  });

  const update = useAction(updateCampaignAction, {
    onExecute: () => setError(null),
    onError: ({ error }) => {
      setError(error.serverError ?? 'campaigns.errors.updateFailed');
    },
  });

  const isPending = create.isPending || update.isPending;

  const form = useForm({
    resolver: zodResolver(CampaignFormSchema),
    defaultValues: props.campaign?.values ?? {
      name: '',
      spaceId: defaultSpace?.id ?? '',
      countryCode: locale.startsWith('fr') ? 'FR' : 'US',
      citiesMode: 'country' as const,
      minPopulation: 0,
      radiusCity: null,
      radiusKm: 30,
      cities: [],
      maxCities: MAX_CITIES_LIMIT,
      // aucune activité présélectionnée : l'utilisateur choisit (une campagne
      // « Restauration » lancée sur les activités courantes ramenait des pharmacies)
      categoriesMode: 'list' as const,
      categories: [],
      ratingMin: RATING_FLOOR,
      ratingMax: 3.5,
      minReviews: 1,
      website: 'with' as const,
      excludePublic: true,
      mainCategoryOnly: true,
      extraExclusions: '',
    },
  });

  const values = useWatch({ control: form.control });

  const countryCode = values.countryCode ?? 'FR';

  const targeting = useMemo(
    () =>
      buildTargeting({
        citiesMode: values.citiesMode ?? 'country',
        minPopulation: values.minPopulation ?? 0,
        radiusCity: (values.radiusCity as CityRef | null) ?? null,
        radiusKm: values.radiusKm ?? 30,
        cities: (values.cities ?? []) as CityRef[],
        maxCities: MAX_CITIES_LIMIT,
        categoriesMode: 'list' as const,
        categories: (values.categories ?? []) as CategoryRef[],
      }),
    [
      values.citiesMode,
      values.minPopulation,
      values.radiusCity,
      values.radiusKm,
      values.cities,
      values.categories,
    ],
  );

  // L'estimation dépend aussi des filtres (note, site web, avis).
  const estimateFilters = useMemo(
    () => ({
      rating_min: Math.max(
        RATING_FLOOR,
        finiteOr(values.ratingMin, RATING_FLOOR),
      ),
      rating_max: finiteOr(values.ratingMax, 5),
      min_reviews: finiteOr(values.minReviews, 0),
      website: values.website ?? 'all',
    }),
    [values.ratingMin, values.ratingMax, values.minReviews, values.website],
  );

  // Estimation réelle : mêmes filtres que la campagne, exclusions comprises
  const realEstimateFilters = useMemo(
    () => ({
      ...estimateFilters,
      exclude_public: values.excludePublic ?? true,
      main_category_only: values.mainCategoryOnly ?? true,
      extra_exclusions: (values.extraExclusions ?? '')
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean),
    }),
    [
      estimateFilters,
      values.excludePublic,
      values.mainCategoryOnly,
      values.extraExclusions,
    ],
  );

  // Les villes appartiennent à un pays : on les oublie quand il change.
  const changeCountry = (code: string) => {
    if (code === form.getValues('countryCode')) {
      return;
    }

    form.setValue('countryCode', code, { shouldValidate: true });
    form.setValue('radiusCity', null);
    form.setValue('cities', []);
  };

  const disabled = isPending || form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        data-test={'campaign-form'}
        className={'grid grid-cols-1 gap-6 pb-32 lg:grid-cols-3'}
        onSubmit={form.handleSubmit((data) =>
          props.campaign
            ? update.execute({
                ...data,
                campaignId: props.campaign.id,
                accountSlug: props.accountSlug,
              })
            : create.execute({
                ...data,
                accountId: props.accountId,
                accountSlug: props.accountSlug,
              }),
        )}
      >
        <div className={'flex flex-col gap-6 lg:col-span-2'}>
          <If condition={props.campaign?.launched}>
            <Alert data-test={'campaign-edit-launched-alert'}>
              <AlertDescription>
                <Trans i18nKey={'campaigns.form.editLaunchedHint'} />
              </AlertDescription>
            </Alert>
          </If>

          <Card>
            <CardHeader>
              <CardTitle>
                <Trans i18nKey={'campaigns.form.generalTitle'} />
              </CardTitle>
            </CardHeader>

            <CardContent className={'flex flex-col gap-4'}>
              <FormField
                name={'name'}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <Trans i18nKey={'campaigns.form.nameLabel'} />
                    </FormLabel>

                    <FormControl>
                      <Input
                        data-test={'campaign-name-input'}
                        maxLength={255}
                        placeholder={t('form.namePlaceholder')}
                        {...field}
                      />
                    </FormControl>

                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className={'grid grid-cols-1 gap-4 md:grid-cols-2'}>
                <If condition={showSpaceSelect}>
                  <FormField
                    name={'spaceId'}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans i18nKey={'campaigns.form.folderLabel'} />
                        </FormLabel>

                        <FormControl>
                          <NativeSelect
                            className={'w-full'}
                            data-test={'campaign-folder-select'}
                            disabled={editing}
                            value={field.value}
                            onChange={(event) =>
                              field.onChange(event.target.value)
                            }
                          >
                            {props.spaces.map((space) => (
                              <NativeSelectOption
                                key={space.id}
                                value={space.id}
                              >
                                {space.label}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </FormControl>

                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </If>

                <FormField
                  name={'countryCode'}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans i18nKey={'campaigns.form.countryLabel'} />
                      </FormLabel>

                      <FormControl>
                        <CountrySelect
                          data-test={'campaign-country-select'}
                          countries={props.countries}
                          value={field.value}
                          onChange={changeCountry}
                          disabled={props.campaign?.launched}
                        />
                      </FormControl>

                      <If condition={props.campaign?.launched}>
                        <FormDescription>
                          <Trans i18nKey={'campaigns.form.countryLocked'} />
                        </FormDescription>
                      </If>

                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <CitiesSection countryCode={countryCode} />

          <CategoriesSection />

          <FiltersSection />

          <If condition={error}>
            {(message) => (
              <Alert variant={'destructive'}>
                <AlertDescription>
                  <Trans i18nKey={message} />
                </AlertDescription>
              </Alert>
            )}
          </If>

          <CampaignRecap />

          <div className={'flex justify-end'}>
            <Button
              type={'submit'}
              data-test={'campaign-save-button'}
              disabled={disabled}
            >
              <Trans
                i18nKey={
                  disabled
                    ? 'campaigns.form.saving'
                    : editing
                      ? 'campaigns.form.saveChanges'
                      : 'campaigns.form.save'
                }
              />
            </Button>
          </div>
        </div>

        <div className={'lg:sticky lg:top-4 lg:self-start'}>
          <CampaignEstimate
            accountId={props.accountId}
            countryCode={countryCode}
            targeting={targeting}
            filters={estimateFilters}
            realFilters={realEstimateFilters}
            balance={props.discoveryBalance}
          />
        </div>
      </form>
    </Form>
  );
}

function CitiesSection(props: { countryCode: string }) {
  const t = useTranslations('campaigns');
  const format = useFormatter();
  const mode = useWatch({ name: 'citiesMode' });

  const searchCities = async (query: string) => {
    const result = await searchCitiesAction({
      countryCode: props.countryCode,
      query,
    });

    if (!result?.data) {
      throw new Error(result?.serverError ?? 'search failed');
    }

    return result.data;
  };

  const renderCity = (city: CityRef) => (
    <>
      <span>{city.name}</span>

      <span className={'text-muted-foreground text-xs tabular-nums'}>
        <Trans
          i18nKey={'campaigns.form.population'}
          values={{ count: format.number(city.population ?? 0) }}
        />
      </span>
    </>
  );

  return (
    <Card className={'overflow-visible'}>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey={'campaigns.form.citiesTitle'} />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey={'campaigns.form.citiesDescription'} />
        </CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        <FormField
          name={'citiesMode'}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <ChoiceGroup
                  data-test={'campaign-cities-mode'}
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'country', label: 'campaigns.form.citiesCountry' },
                    { value: 'radius', label: 'campaigns.form.citiesRadius' },
                    { value: 'list', label: 'campaigns.form.citiesList' },
                  ]}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />

        <If condition={mode === 'country'}>
          <FormField
            name={'minPopulation'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'campaigns.form.minPopulationLabel'} />
                </FormLabel>

                <FormControl>
                  <NumberInput
                    data-test={'campaign-min-population-input'}
                    min={0}
                    step={1000}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>

                <FormDescription>
                  <Trans i18nKey={'campaigns.form.minPopulationHint'} />
                </FormDescription>

                <FormMessage />
              </FormItem>
            )}
          />
        </If>

        <If condition={mode === 'radius'}>
          <div className={'grid grid-cols-1 gap-4 md:grid-cols-3'}>
            <FormField
              name={'radiusCity'}
              render={({ field }) => {
                const city = field.value as CityRef | null;

                return (
                  <FormItem className={'md:col-span-2'}>
                    <FormLabel>
                      <Trans i18nKey={'campaigns.form.radiusCityLabel'} />
                    </FormLabel>

                    <FormControl>
                      {city ? (
                        <SelectedChip
                          data-test={'campaign-radius-city'}
                          label={city.name}
                          onRemove={() => field.onChange(null)}
                        />
                      ) : (
                        <SearchPicker
                          data-test={'campaign-radius-city-search'}
                          queryKey={['lm-cities', props.countryCode]}
                          search={searchCities}
                          getKey={(item) => String(item.geonameId)}
                          renderItem={renderCity}
                          onSelect={(item) => field.onChange(item)}
                          placeholder={t('form.citySearchPlaceholder')}
                        />
                      )}
                    </FormControl>

                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <FormField
              name={'radiusKm'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey={'campaigns.form.radiusKmLabel'} />
                  </FormLabel>

                  <FormControl>
                    <NumberInput
                      data-test={'campaign-radius-km-input'}
                      min={1}
                      max={500}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </If>

        <If condition={mode === 'list'}>
          <FormField
            name={'cities'}
            render={({ field }) => (
              <CitiesListField
                cities={(field.value ?? []) as CityRef[]}
                onChange={field.onChange}
                countryCode={props.countryCode}
                searchCities={searchCities}
                renderCity={renderCity}
              />
            )}
          />
        </If>
      </CardContent>
    </Card>
  );
}

/** Nombre de villes affichées avant « Tout afficher ». */
const CITIES_PREVIEW = 40;

function CitiesListField(props: {
  cities: CityRef[];
  onChange: (cities: CityRef[]) => void;
  countryCode: string;
  searchCities: (query: string) => Promise<CityRef[]>;
  renderCity: (city: CityRef) => React.ReactNode;
}) {
  const t = useTranslations('campaigns');
  const { cities, onChange } = props;

  const [nearby, setNearby] = useState<{
    open: boolean;
    center: CityRef | null;
  }>({ open: false, center: null });
  const [showAll, setShowAll] = useState(false);

  const existingIds = useMemo(
    () => new Set(cities.map((city) => city.geonameId)),
    [cities],
  );

  const addCities = (added: CityRef[]) => {
    const fresh = added.filter((city) => !existingIds.has(city.geonameId));

    onChange([...cities, ...fresh].slice(0, MAX_LIST_CITIES));
  };

  const visible = showAll ? cities : cities.slice(0, CITIES_PREVIEW);

  return (
    <FormItem>
      <div className={'flex flex-wrap items-center justify-between gap-2'}>
        <FormLabel>
          <Trans i18nKey={'campaigns.form.citiesListLabel'} />
        </FormLabel>

        <Button
          type={'button'}
          size={'sm'}
          variant={'outline'}
          data-test={'campaign-nearby-open'}
          onClick={() => setNearby({ open: true, center: null })}
        >
          <MapPin className={'mr-1.5 size-4'} />
          <Trans i18nKey={'campaigns.form.nearbyOpen'} />
        </Button>
      </div>

      <FormControl>
        <SearchPicker
          data-test={'campaign-cities-search'}
          queryKey={['lm-cities', props.countryCode]}
          search={props.searchCities}
          getKey={(item) => String(item.geonameId)}
          renderItem={props.renderCity}
          isSelected={(item) => existingIds.has(item.geonameId)}
          onSelect={(item) => addCities([item])}
          secondaryAction={{
            label: t('form.nearbyButton'),
            'data-test': 'campaign-city-nearby',
            onSelect: (item) => setNearby({ open: true, center: item }),
          }}
          placeholder={t('form.citySearchPlaceholder')}
        />
      </FormControl>

      <FormDescription>
        <Trans i18nKey={'campaigns.form.nearbyHint'} />
      </FormDescription>

      <If condition={cities.length > 0}>
        <div className={'flex items-center justify-between gap-2 text-sm'}>
          <span className={'text-muted-foreground'}>
            <Trans
              i18nKey={'campaigns.form.citiesCount'}
              values={{ count: cities.length }}
            />
          </span>

          <Button
            type={'button'}
            size={'sm'}
            variant={'ghost'}
            data-test={'campaign-cities-clear'}
            onClick={() => onChange([])}
          >
            <Trans i18nKey={'campaigns.form.citiesClear'} />
          </Button>
        </div>
      </If>

      <ChipList>
        {visible.map((city) => (
          <SelectedChip
            key={city.geonameId}
            label={city.name}
            onRemove={() =>
              onChange(cities.filter((c) => c.geonameId !== city.geonameId))
            }
          />
        ))}

        {cities.length > CITIES_PREVIEW ? (
          <Button
            type={'button'}
            size={'sm'}
            variant={'link'}
            className={'h-7'}
            onClick={() => setShowAll((value) => !value)}
          >
            <Trans
              i18nKey={
                showAll
                  ? 'campaigns.form.citiesShowLess'
                  : 'campaigns.form.citiesShowAll'
              }
              values={{ count: cities.length - CITIES_PREVIEW }}
            />
          </Button>
        ) : null}
      </ChipList>

      <FormMessage />

      <NearbyCitiesDialog
        open={nearby.open}
        onOpenChange={(open) => setNearby((prev) => ({ ...prev, open }))}
        countryCode={props.countryCode}
        initialCenter={nearby.center}
        existingIds={existingIds}
        remaining={MAX_LIST_CITIES - cities.length}
        searchCities={props.searchCities}
        renderCity={props.renderCity}
        onAdd={addCities}
      />
    </FormItem>
  );
}

function CategoriesSection() {
  const t = useTranslations('campaigns');
  const locale = useLocale();
  const [browsing, setBrowsing] = useState(false);

  const searchCategories = async (query: string) => {
    const result = await searchCategoriesAction({ query });

    if (!result?.data) {
      throw new Error(result?.serverError ?? 'search failed');
    }

    return result.data.map((category) => ({
      gcid: category.gcid,
      label: locale.startsWith('fr') ? category.labelFr : category.labelEn,
      family: category.family,
    }));
  };

  return (
    <Card className={'overflow-visible'}>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey={'campaigns.form.categoriesTitle'} />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey={'campaigns.form.categoriesDescription'} />
        </CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        <FormField
          name={'categories'}
          render={({ field }) => {
            const categories = (field.value ?? []) as CategoryRef[];

            return (
              <FormItem>
                <div
                  className={
                    'flex flex-wrap items-center justify-between gap-2'
                  }
                >
                  <FormLabel>
                    <Trans i18nKey={'campaigns.form.categoriesListLabel'} />
                  </FormLabel>

                  <Button
                    type={'button'}
                    size={'sm'}
                    variant={'outline'}
                    data-test={'campaign-categories-browse'}
                    onClick={() => setBrowsing(true)}
                  >
                    <ListTree className={'mr-1.5 size-4'} />
                    <Trans i18nKey={'campaigns.form.browseOpen'} />
                  </Button>
                </div>

                <FormControl>
                  <SearchPicker
                    data-test={'campaign-categories-search'}
                    queryKey={['lm-categories', locale]}
                    minLength={2}
                    search={searchCategories}
                    getKey={(item) => item.gcid}
                    isSelected={(item) =>
                      categories.some((c) => c.gcid === item.gcid)
                    }
                    renderItem={(item) => (
                      <>
                        <span>{item.label}</span>

                        <span className={'text-muted-foreground text-xs'}>
                          {item.family}
                        </span>
                      </>
                    )}
                    onSelect={(item) => {
                      if (!categories.some((c) => c.gcid === item.gcid)) {
                        field.onChange([...categories, item]);
                      }
                    }}
                    placeholder={t('form.categorySearchPlaceholder')}
                  />
                </FormControl>

                <If condition={categories.length > 0}>
                  <div
                    className={
                      'flex items-center justify-between gap-2 text-sm'
                    }
                  >
                    <span className={'text-muted-foreground'}>
                      <Trans
                        i18nKey={'campaigns.form.browseSelected'}
                        values={{ count: categories.length }}
                      />
                    </span>

                    <Button
                      type={'button'}
                      size={'sm'}
                      variant={'ghost'}
                      onClick={() => field.onChange([])}
                    >
                      <Trans i18nKey={'campaigns.form.citiesClear'} />
                    </Button>
                  </div>
                </If>

                <ChipList>
                  {categories.map((category) => (
                    <SelectedChip
                      key={category.gcid}
                      label={category.label}
                      detail={category.family}
                      onRemove={() =>
                        field.onChange(
                          categories.filter((c) => c.gcid !== category.gcid),
                        )
                      }
                    />
                  ))}
                </ChipList>

                <FormMessage />

                <CategoryBrowserDialog
                  open={browsing}
                  onOpenChange={setBrowsing}
                  selected={categories}
                  onChange={(next) =>
                    field.onChange(next, { shouldValidate: true })
                  }
                  max={1000}
                />
              </FormItem>
            );
          }}
        />
      </CardContent>
    </Card>
  );
}

function FiltersSection() {
  const t = useTranslations('campaigns');

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey={'campaigns.form.filtersTitle'} />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey={'campaigns.form.filtersDescription'} />
        </CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        <div className={'grid grid-cols-1 gap-4 md:grid-cols-3'}>
          <FormField
            name={'ratingMin'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'campaigns.form.ratingMinLabel'} />
                </FormLabel>

                <FormControl>
                  <NumberInput
                    data-test={'campaign-rating-min-input'}
                    min={RATING_FLOOR}
                    max={5}
                    step={0.1}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            name={'ratingMax'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'campaigns.form.ratingMaxLabel'} />
                </FormLabel>

                <FormControl>
                  <NumberInput
                    data-test={'campaign-rating-max-input'}
                    min={RATING_FLOOR}
                    max={5}
                    step={0.1}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            name={'minReviews'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'campaigns.form.minReviewsLabel'} />
                </FormLabel>

                <FormControl>
                  <NumberInput
                    data-test={'campaign-min-reviews-input'}
                    min={0}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormDescription>
          <Trans i18nKey={'campaigns.form.ratingHint'} />
        </FormDescription>

        <FormField
          name={'website'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'campaigns.form.websiteLabel'} />
              </FormLabel>

              <FormControl>
                <ChoiceGroup
                  data-test={'campaign-website-mode'}
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'with', label: 'campaigns.form.websiteWith' },
                    {
                      value: 'without',
                      label: 'campaigns.form.websiteWithout',
                    },
                    { value: 'all', label: 'campaigns.form.websiteAll' },
                  ]}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name={'mainCategoryOnly'}
          render={({ field }) => (
            <FormItem>
              <label
                className={'flex cursor-pointer items-center gap-2 text-sm'}
              >
                <FormControl>
                  <Checkbox
                    data-test={'campaign-main-category-checkbox'}
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked)}
                  />
                </FormControl>

                <Trans i18nKey={'campaigns.form.mainCategoryOnlyLabel'} />
              </label>

              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name={'excludePublic'}
          render={({ field }) => (
            <FormItem>
              <label
                className={'flex cursor-pointer items-center gap-2 text-sm'}
              >
                <FormControl>
                  <Checkbox
                    data-test={'campaign-exclude-public-checkbox'}
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked)}
                  />
                </FormControl>

                <Trans i18nKey={'campaigns.form.excludePublicLabel'} />
              </label>

              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name={'extraExclusions'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'campaigns.form.extraExclusionsLabel'} />
              </FormLabel>

              <FormControl>
                <Input
                  data-test={'campaign-extra-exclusions-input'}
                  maxLength={2000}
                  placeholder={t('form.extraExclusionsPlaceholder')}
                  {...field}
                />
              </FormControl>

              <FormDescription>
                <Trans i18nKey={'campaigns.form.extraExclusionsHint'} />
              </FormDescription>

              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Résumé en une phrase de ce que la campagne va chercher, juste avant le
 * bouton d'enregistrement : on voit tout de suite un ciblage qui ne
 * correspond pas à l'intention (activités, villes).
 */
function CampaignRecap() {
  const t = useTranslations('campaigns.form.recap');
  const values = useWatch() as Partial<CampaignFormValues>;
  const categories = (values.categories ?? []) as CategoryRef[];
  const cities = (values.cities ?? []) as CityRef[];

  const preview = (labels: string[]) =>
    labels.length <= 3
      ? labels.join(', ')
      : t('andMore', {
          list: labels.slice(0, 3).join(', '),
          count: labels.length - 3,
        });

  const what =
    categories.length === 0
      ? null
      : preview(categories.map((category) => category.label));

  const where =
    values.citiesMode === 'radius'
      ? values.radiusCity
        ? t('whereRadius', {
            city: (values.radiusCity as CityRef).name,
            km: values.radiusKm ?? 30,
          })
        : null
      : values.citiesMode === 'list'
        ? cities.length === 0
          ? null
          : preview(cities.map((city) => city.name))
        : (values.minPopulation ?? 0) > 0
          ? t('whereCountryMin', { min: values.minPopulation ?? 0 })
          : t('whereCountry');

  return (
    <Alert data-test={'campaign-recap'}>
      <AlertDescription className={'flex flex-col gap-1'}>
        <span className={'text-foreground font-medium'}>{t('title')}</span>
        <span>
          {t('what')}{' '}
          {what ? (
            <strong className={'text-foreground'}>{what}</strong>
          ) : (
            <span className={'text-destructive'}>{t('whatMissing')}</span>
          )}
        </span>
        <span>
          {t('where')}{' '}
          {where ? (
            <strong className={'text-foreground'}>{where}</strong>
          ) : (
            <span className={'text-destructive'}>{t('whereMissing')}</span>
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}

function ChoiceGroup(props: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; description?: string }>;
  'data-test'?: string;
}) {
  return (
    <RadioGroup
      data-test={props['data-test']}
      value={props.value}
      onValueChange={(value) => props.onChange(String(value))}
    >
      {props.options.map((option) => (
        <RadioGroupItemLabel
          key={option.value}
          selected={props.value === option.value}
          data-test={`${props['data-test']}-${option.value}`}
          onClick={() => props.onChange(option.value)}
        >
          <RadioGroupItem value={option.value} />

          <span className={'flex flex-col'}>
            <span>
              <Trans i18nKey={option.label} />
            </span>

            {option.description ? (
              <span className={'text-muted-foreground text-xs'}>
                <Trans i18nKey={option.description} />
              </span>
            ) : null}
          </span>
        </RadioGroupItemLabel>
      ))}
    </RadioGroup>
  );
}

function NumberInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      type={'number'}
      inputMode={'decimal'}
      value={Number.isFinite(value) ? value : ''}
      onChange={(event) => onChange(event.target.valueAsNumber)}
      {...props}
    />
  );
}

function ChipList(props: React.PropsWithChildren) {
  return <div className={'flex flex-wrap gap-2'}>{props.children}</div>;
}

function SelectedChip(props: {
  label: string;
  detail?: string;
  onRemove: () => void;
  'data-test'?: string;
}) {
  const t = useTranslations('campaigns');

  return (
    <Badge
      variant={'secondary'}
      className={'h-7 gap-1.5 pr-1 pl-2.5 text-sm'}
      data-test={props['data-test'] ?? 'selected-chip'}
    >
      <span>{props.label}</span>

      {props.detail ? (
        <span className={'text-muted-foreground text-xs'}>{props.detail}</span>
      ) : null}

      <button
        type={'button'}
        className={'hover:bg-muted rounded-sm p-0.5'}
        aria-label={t('form.remove')}
        onClick={props.onRemove}
      >
        <X className={'size-3.5'} />
      </button>
    </Badge>
  );
}

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
