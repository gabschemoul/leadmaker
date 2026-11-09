'use client';

/**
 * Rôle : écran « Qui ? » : création / modification d'une campagne (CDC-PARCOURS-TRI-ANNUAIRE §3). Dans l'ordre :
 * la cible en une phrase, ses précisions et les activités cherchées, l'offre du dossier (./campaign-form/who-section),
 * « Où ? » (ciblage inchangé), « Plus de critères » (filtres, fermé par défaut), puis « Lancer la recherche ».
 * Plus d'écran d'estimation : le prix se mesure sur les premières entreprises triées.
 * Données : espaces, offres des dossiers, pays et limite d'activités passés par la page.
 * Écritures : createCampaignAction / updateCampaignAction (campagne, offre, cible, lancement).
 */

import { useMemo, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { type FieldErrors, useForm, useWatch } from 'react-hook-form';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
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
  type CampaignFormValues,
  MAX_CITIES_LIMIT,
  RATING_FLOOR,
  buildCampaignFormSchema,
} from '../_lib/schema/campaign.schema';
import {
  createCampaignAction,
  updateCampaignAction,
} from '../_lib/server/campaign-lifecycle-actions';
import { CitiesSection } from './campaign-form/cities-section';
import { FiltersSection } from './campaign-form/filters-section';
import { WhoSection } from './campaign-form/who-section';

interface SpaceOption {
  id: string;
  label: string;
  is_default: boolean;
}

/** Champs du pli « Plus de critères » : une erreur sur l'un d'eux ouvre le pli. */
const CRITERIA_FIELDS = [
  'ratingMin',
  'ratingMax',
  'minReviews',
  'website',
  'extraExclusions',
] as const;

export function CampaignForm(props: {
  accountId: string;
  accountSlug: string;
  spaces: SpaceOption[];
  /** « Votre offre » enregistrée pour chaque dossier (vide si aucune) */
  spaceOffers: Record<string, string>;
  countries: CountryOption[];
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
  const [state, setState] = useState({
    error: null as string | null,
    criteriaOpen: false,
  });

  const setError = (error: string | null) =>
    setState((current) => ({ ...current, error }));

  const editing = Boolean(props.campaign);
  const launched = props.campaign?.launched ?? false;
  const initialTarget = props.campaign?.values.sortTarget ?? '';

  // Cible obligatoire, sauf pour une ancienne campagne déjà lancée sans cible (ancien parcours)
  const targetRequired = !launched || initialTarget.length > 0;

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

  const schema = useMemo(
    () => buildCampaignFormSchema(targetRequired),
    [targetRequired],
  );

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: props.campaign?.values ?? {
      sortTarget: '',
      offer: props.spaceOffers[defaultSpace?.id ?? ''] ?? '',
      name: '',
      spaceId: defaultSpace?.id ?? '',
      countryCode: locale.startsWith('fr') ? 'FR' : 'US',
      citiesMode: 'country' as const,
      minPopulation: 0,
      radiusCity: null,
      radiusKm: 30,
      cities: [],
      maxCities: MAX_CITIES_LIMIT,
      // aucune activité présélectionnée à l'ouverture : elles sont proposées d'après la phrase, et le client
      // choisit (une campagne « Restauration » lancée sur les activités courantes ramenait des pharmacies)
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

  const countryCode = useWatch({ control: form.control, name: 'countryCode' });
  const sortTarget = useWatch({ control: form.control, name: 'sortTarget' });

  // Les villes appartiennent à un pays : on les oublie quand il change.
  const changeCountry = (code: string) => {
    if (code === form.getValues('countryCode')) {
      return;
    }

    form.setValue('countryCode', code, { shouldValidate: true });
    form.setValue('radiusCity', null);
    form.setValue('cities', []);
  };

  // L'offre appartient au dossier : on reprend celle du dossier choisi.
  const changeSpace = (spaceId: string) => {
    form.setValue('spaceId', spaceId, { shouldValidate: true });
    form.setValue('offer', props.spaceOffers[spaceId] ?? '');
  };

  const onInvalid = (errors: FieldErrors<CampaignFormValues>) => {
    if (CRITERIA_FIELDS.some((name) => errors[name])) {
      setState((current) => ({ ...current, criteriaOpen: true }));
    }
  };

  const disabled = isPending || form.formState.isSubmitting;

  // « Lancer la recherche » : nouvelle campagne ou brouillon ; campagne lancée : enregistrer les changements
  const launches = !launched;
  const retargets =
    launched &&
    initialTarget.length > 0 &&
    (sortTarget ?? '').trim() !== initialTarget;

  return (
    <Form {...form}>
      <form
        data-test={'campaign-form'}
        className={'flex max-w-3xl flex-col gap-6 pb-32'}
        onSubmit={form.handleSubmit(
          (data) =>
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
          onInvalid,
        )}
      >
        <If condition={launched}>
          <Alert data-test={'campaign-edit-launched-alert'}>
            <AlertDescription>
              <Trans i18nKey={'campaigns.form.editLaunchedHint'} />
            </AlertDescription>
          </Alert>
        </If>

        <WhoSection
          categoryLimit={props.categoryLimit}
          spaceOffers={props.spaceOffers}
          autoName={!editing}
        />

        <CitiesSection countryCode={countryCode ?? 'FR'}>
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
                    disabled={launched}
                  />
                </FormControl>

                <If condition={launched}>
                  <FormDescription>
                    <Trans i18nKey={'campaigns.form.countryLocked'} />
                  </FormDescription>
                </If>

                <FormMessage />
              </FormItem>
            )}
          />
        </CitiesSection>

        <FiltersSection
          open={state.criteriaOpen}
          onOpenChange={(criteriaOpen) =>
            setState((current) => ({ ...current, criteriaOpen }))
          }
        />

        <Card>
          <CardContent className={'grid grid-cols-1 gap-4 md:grid-cols-2'}>
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
                        onChange={(event) => changeSpace(event.target.value)}
                      >
                        {props.spaces.map((space) => (
                          <NativeSelectOption key={space.id} value={space.id}>
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
          </CardContent>
        </Card>

        <If condition={state.error}>
          {(message) => (
            <Alert variant={'destructive'}>
              <AlertDescription>
                <Trans i18nKey={message} />
              </AlertDescription>
            </Alert>
          )}
        </If>

        <div className={'flex flex-col items-end gap-2'}>
          <Button
            type={'submit'}
            size={'lg'}
            data-test={'campaign-save-button'}
            loading={disabled}
          >
            <Trans
              i18nKey={
                disabled
                  ? launches
                    ? 'campaigns.form.launching'
                    : 'campaigns.form.saving'
                  : launches
                    ? 'campaigns.form.launch'
                    : 'campaigns.form.saveChanges'
              }
            />
          </Button>

          <p
            className={'text-muted-foreground text-sm'}
            data-test={'campaign-launch-hint'}
          >
            <Trans
              i18nKey={
                retargets
                  ? 'campaigns.form.who.retargetHint'
                  : 'campaigns.form.payKeptOnly'
              }
            />
          </p>
        </div>
      </form>
    </Form>
  );
}
