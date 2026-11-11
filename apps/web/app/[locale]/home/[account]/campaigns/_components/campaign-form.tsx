'use client';

/**
 * Rôle : écran « Qui ? » : création / modification d'une campagne (CDC-PARCOURS-TRI-ANNUAIRE §3). Dans l'ordre :
 * la cible en une phrase, ses précisions et les activités cherchées, l'offre du dossier (./campaign-form/who-section),
 * « Où ? » (ciblage inchangé), « Plus de critères » (filtres, fermé par défaut), puis « Lancer la recherche ».
 * Plus d'écran d'estimation : le prix se mesure sur les premières entreprises triées.
 * Données : espaces, offres des dossiers, pays et limite d'activités passés par la page.
 * Écritures : createCampaignAction / updateCampaignAction (campagne, offre, cible, lancement).
 */

import { useEffect, useState } from 'react';

import Link from 'next/link';

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
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import type { CountryOption } from '~/lib/leadmaker/countries';

import { CountrySelect } from '../../_components/leadmaker/country-select';
import {
  type CampaignFormValues,
  MAX_CITIES_LIMIT,
  CampaignFormSchema,
  RATING_FLOOR,
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

type CampaignFormProps = Parameters<typeof CampaignFormBody>[0];

/**
 * Les pages déjà vues restent montées en arrière-plan (cacheComponents) : « Nouvelle campagne » rouvrait avec tout
 * ce qui avait été saisi pour la campagne précédente, activités proposées par l'IA comprises (retour de Gabriel,
 * 11/11). En création, le formulaire est donc remonté à neuf chaque fois que la page revient. En modification, il
 * garde ses valeurs (celles enregistrées).
 * useEffect justifié : son nettoyage tourne quand la page passe en arrière-plan.
 */
export function CampaignForm(props: CampaignFormProps) {
  const [generation, setGeneration] = useState(0);
  const creating = !props.campaign;

  useEffect(() => {
    if (!creating) {
      return;
    }

    return () => setGeneration((current) => current + 1);
  }, [creating]);

  return <CampaignFormBody key={generation} {...props} />;
}

function CampaignFormBody(props: {
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
    /** triée sans phrase (cible tirée des activités) : taper une phrase relance aussi tout le tri */
    activitiesTarget?: boolean;
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

  // Une seule entrée = l'espace par défaut : le choix du dossier client est masqué.
  const defaultSpace =
    props.spaces.find((space) => space.is_default) ?? props.spaces[0];

  const showSpaceSelect = props.spaces.length > 1;

  // brouillon enregistré : on arrive sur sa page, un message le confirme (retour du 11/11 : aucune indication)
  const confirmDraft = ({ input }: { input: { launch?: boolean } }) => {
    if (input.launch === false) {
      toast.success(t('form.draftSaved'));
    }
  };

  const create = useAction(createCampaignAction, {
    onExecute: () => setError(null),
    onNavigation: confirmDraft,
    onError: ({ error }) => {
      setError(error.serverError ?? 'campaigns.errors.createFailed');
    },
  });

  const update = useAction(updateCampaignAction, {
    onExecute: () => setError(null),
    onNavigation: confirmDraft,
    onError: ({ error }) => {
      setError(error.serverError ?? 'campaigns.errors.updateFailed');
    },
  });

  const isPending = create.isPending || update.isPending;

  const defaultValues: CampaignFormValues = props.campaign?.values ?? {
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
    // critères neutres par défaut (analyse UX Q-01, 11/11) : la note max 3,5 et « au moins 1 avis » venaient
    // du premier usage (entreprises mal notées) et écartaient en silence les entreprises bien notées
    ratingMin: RATING_FLOOR,
    ratingMax: 5,
    minReviews: 0,
    website: 'with' as const,
    excludePublic: true,
    mainCategoryOnly: true,
    extraExclusions: '',
  };

  const form = useForm({
    resolver: zodResolver(CampaignFormSchema),
    defaultValues,
  });

  // bouton cliqué : « Lancer la recherche » ou « Enregistrer en brouillon » (pour le bouton qui tourne)
  const [launch, setLaunch] = useState(true);

  const save = (data: CampaignFormValues, launchNow: boolean) => {
    setLaunch(launchNow);

    return props.campaign
      ? update.execute({
          ...data,
          campaignId: props.campaign.id,
          accountSlug: props.accountSlug,
          launch: launchNow,
        })
      : create.execute({
          ...data,
          accountId: props.accountId,
          accountSlug: props.accountSlug,
          launch: launchNow,
        });
  };

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
  const campaignHref = props.campaign
    ? `/home/${props.accountSlug}/campaigns/${props.campaign.id}`
    : `/home/${props.accountSlug}/campaigns`;
  const retargets =
    launched &&
    (initialTarget.length > 0 || Boolean(props.campaign?.activitiesTarget)) &&
    (sortTarget ?? '').trim() !== initialTarget;

  return (
    <Form {...form}>
      <form
        data-test={'campaign-form'}
        className={'flex w-full flex-col gap-6 pb-32'}
        onSubmit={form.handleSubmit((data) => save(data, true), onInvalid)}
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
          editing={editing}
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
          <div className={'flex flex-wrap items-center justify-end gap-2'}>
            <Button
              variant={'ghost'}
              size={'lg'}
              data-test={'campaign-cancel-button'}
              nativeButton={false}
              // les changements non enregistrés sont oubliés (la page reste montée en arrière-plan)
              onClick={() => form.reset()}
              render={<Link href={campaignHref} />}
            >
              <Trans i18nKey={'campaigns.form.cancel'} />
            </Button>

            <If condition={launches}>
              <Button
                type={'button'}
                variant={'outline'}
                size={'lg'}
                data-test={'campaign-draft-button'}
                disabled={disabled}
                loading={disabled && !launch}
                onClick={form.handleSubmit(
                  (data) => save(data, false),
                  onInvalid,
                )}
              >
                <Trans i18nKey={'campaigns.form.saveDraft'} />
              </Button>
            </If>

            <Button
              type={'submit'}
              size={'lg'}
              data-test={'campaign-save-button'}
              disabled={disabled}
              loading={disabled && launch}
            >
              <Trans
                i18nKey={
                  disabled && launch
                    ? launches
                      ? 'campaigns.form.launching'
                      : 'campaigns.form.saving'
                    : launches
                      ? 'campaigns.form.launch'
                      : 'campaigns.form.saveChanges'
                }
              />
            </Button>
          </div>

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
