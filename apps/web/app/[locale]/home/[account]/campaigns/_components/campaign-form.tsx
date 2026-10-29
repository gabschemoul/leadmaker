'use client';

import { useMemo, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
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
  type CityRef,
  MAX_CITIES_LIMIT,
  buildTargeting,
} from '../_lib/schema/campaign.schema';
import {
  createCampaignAction,
  searchCategoriesAction,
  searchCitiesAction,
} from '../_lib/server/server-actions';
import { CampaignEstimate } from './campaign-estimate';
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
}) {
  const t = useTranslations('campaigns');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);

  // Une seule entrée = l'espace par défaut : le choix du dossier client est masqué.
  const defaultSpace =
    props.spaces.find((space) => space.is_default) ?? props.spaces[0];

  const showSpaceSelect = props.spaces.length > 1;

  const { execute, isPending } = useAction(createCampaignAction, {
    onExecute: () => setError(null),
    onError: ({ error }) => {
      setError(error.serverError ?? 'campaigns.errors.createFailed');
    },
  });

  const form = useForm({
    resolver: zodResolver(CampaignFormSchema),
    defaultValues: {
      name: '',
      spaceId: defaultSpace?.id ?? '',
      countryCode: locale.startsWith('fr') ? 'FR' : 'US',
      citiesMode: 'country' as const,
      minPopulation: 0,
      radiusCity: null,
      radiusKm: 30,
      cities: [],
      maxCities: MAX_CITIES_LIMIT,
      categoriesMode: 'generic' as const,
      categories: [],
      ratingMin: 0.8,
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
        categoriesMode: values.categoriesMode ?? 'generic',
        categories: (values.categories ?? []) as CategoryRef[],
      }),
    [
      values.citiesMode,
      values.minPopulation,
      values.radiusCity,
      values.radiusKm,
      values.cities,
      values.categoriesMode,
      values.categories,
    ],
  );

  // L'estimation dépend aussi des filtres (note, site web, avis).
  const estimateFilters = useMemo(
    () => ({
      rating_min: finiteOr(values.ratingMin, 0),
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
          execute({
            ...data,
            accountId: props.accountId,
            accountSlug: props.accountSlug,
          }),
        )}
      >
        <div className={'flex flex-col gap-6 lg:col-span-2'}>
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
                        />
                      </FormControl>

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

          <div className={'flex justify-end'}>
            <Button
              type={'submit'}
              data-test={'campaign-save-button'}
              disabled={disabled}
            >
              <Trans
                i18nKey={
                  disabled ? 'campaigns.form.saving' : 'campaigns.form.save'
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
            render={({ field }) => {
              const cities = (field.value ?? []) as CityRef[];

              return (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey={'campaigns.form.citiesListLabel'} />
                  </FormLabel>

                  <FormControl>
                    <SearchPicker
                      data-test={'campaign-cities-search'}
                      queryKey={['lm-cities', props.countryCode]}
                      search={searchCities}
                      getKey={(item) => String(item.geonameId)}
                      renderItem={renderCity}
                      isSelected={(item) =>
                        cities.some((c) => c.geonameId === item.geonameId)
                      }
                      onSelect={(item) => {
                        if (
                          !cities.some((c) => c.geonameId === item.geonameId)
                        ) {
                          field.onChange([...cities, item]);
                        }
                      }}
                      placeholder={t('form.citySearchPlaceholder')}
                    />
                  </FormControl>

                  <ChipList>
                    {cities.map((city) => (
                      <SelectedChip
                        key={city.geonameId}
                        label={city.name}
                        onRemove={() =>
                          field.onChange(
                            cities.filter(
                              (c) => c.geonameId !== city.geonameId,
                            ),
                          )
                        }
                      />
                    ))}
                  </ChipList>

                  <FormMessage />
                </FormItem>
              );
            }}
          />
        </If>
      </CardContent>
    </Card>
  );
}

function CategoriesSection() {
  const t = useTranslations('campaigns');
  const locale = useLocale();
  const mode = useWatch({ name: 'categoriesMode' });

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
          name={'categoriesMode'}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <ChoiceGroup
                  data-test={'campaign-categories-mode'}
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    {
                      value: 'generic',
                      label: 'campaigns.form.categoriesGeneric',
                      description: 'campaigns.form.categoriesGenericHint',
                    },
                    {
                      value: 'all',
                      label: 'campaigns.form.categoriesAll',
                      description: 'campaigns.form.categoriesAllHint',
                    },
                    { value: 'list', label: 'campaigns.form.categoriesList' },
                  ]}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />

        <If condition={mode === 'list'}>
          <FormField
            name={'categories'}
            render={({ field }) => {
              const categories = (field.value ?? []) as CategoryRef[];

              return (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey={'campaigns.form.categoriesListLabel'} />
                  </FormLabel>

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
                </FormItem>
              );
            }}
          />
        </If>
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
                    min={0}
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
                    min={0}
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
