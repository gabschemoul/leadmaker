'use client';

/**
 * Rôle : formulaire de création / modification d'une campagne (point d'entrée ; sections dans ./campaign-form/).
 * Données : espaces, pays, solde et limite d'activités passés par la page ; estimation en direct (CampaignEstimate).
 * Écritures : createCampaignAction / updateCampaignAction (lm_campaigns) à l'enregistrement.
 */

import { useMemo, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm, useWatch } from 'react-hook-form';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
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
import { Trans } from '@kit/ui/trans';

import type { CountryOption } from '~/lib/leadmaker/countries';

import { CountrySelect } from '../../_components/leadmaker/country-select';
import {
  type CategoryRef,
  CampaignFormSchema,
  type CampaignFormValues,
  type CityRef,
  MAX_CITIES_LIMIT,
  RATING_FLOOR,
  buildTargeting,
} from '../_lib/schema/campaign.schema';
import {
  createCampaignAction,
  updateCampaignAction,
} from '../_lib/server/campaign-lifecycle-actions';
import { CampaignEstimate } from './campaign-estimate';
import { CategoriesSection } from './campaign-form/categories-section';
import { CitiesSection } from './campaign-form/cities-section';
import { FiltersSection } from './campaign-form/filters-section';
import { CampaignRecap } from './campaign-form/recap';

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
  /** activités au plus (1 000, davantage pour les utilisateurs sans limite) */
  categoryLimit: number;
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

          <CategoriesSection limit={props.categoryLimit} />

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
              loading={disabled}
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

        <div className={'lg:sticky lg:top-16 lg:self-start'}>
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

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
