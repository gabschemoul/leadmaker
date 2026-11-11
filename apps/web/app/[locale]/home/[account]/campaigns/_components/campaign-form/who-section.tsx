'use client';

/**
 * Rôle : carte « Qui voulez-vous contacter ? » de l'écran « Qui ? » (CDC-PARCOURS-TRI-ANNUAIRE §3) : la cible en
 * une phrase, les précisions proposées en puces, les activités cherchées (« On cherchera ») et l'offre du dossier.
 * Données : suggestTargetAction (précisions + activités proposées d'après la phrase, ~1 s après la frappe) ;
 * offres des dossiers passées par la page.
 * Écritures : aucune en base (champs `sortTarget`, `categories`, `offer`, `name` du formulaire parent).
 */

import { useEffect, useRef, useState } from 'react';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useFormContext, useWatch } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Spinner } from '@kit/ui/spinner';
import { Textarea } from '@kit/ui/textarea';
import { Trans } from '@kit/ui/trans';

import {
  type CampaignFormValues,
  OFFER_MAX,
  SORT_TARGET_MAX,
} from '../../_lib/schema/campaign.schema';
import {
  suggestActivitiesAction,
  suggestTargetAction,
} from '../../_lib/server/ai-actions';
import { searchCitiesAction } from '../../_lib/server/geo-actions';
import { useDebouncedValue } from '../../_lib/use-debounced-value';
import { CategoriesSection } from './categories-section';

/** Pause de frappe avant de proposer des précisions et des activités. */
const SUGGEST_DELAY = 1000;

/** Longueur de phrase acceptée par suggestTargetAction. */
const SUGGEST_MAX = 300;

/** Puces affichées au plus. */
const MAX_CHIPS = 8;

/** Nom de campagne proposé (par l'IA, d'après la phrase ou les activités), tant que le client ne l'a pas changé. */
const AUTO_NAME_MAX = 80;

/** Activités citées dans un nom tiré des activités (« Restaurant, Pizzeria et 12 autres »). */
const AUTO_NAME_ACTIVITIES = 2;

export function WhoSection(props: {
  categoryLimit: number;
  /** « Votre offre » enregistrée pour chaque dossier (vide si aucune) */
  spaceOffers: Record<string, string>;
  /** modification : le nom ne change que si la phrase ou les activités changent */
  editing: boolean;
}) {
  const t = useTranslations('campaigns.form.who');
  const locale = useLocale();
  const form = useFormContext<CampaignFormValues>();
  const phrase = (useWatch({ name: 'sortTarget' }) as string | undefined) ?? '';
  const spaceId = (useWatch({ name: 'spaceId' }) as string | undefined) ?? '';
  const offer = (useWatch({ name: 'offer' }) as string | undefined) ?? '';
  const [state, setState] = useState({
    /** précisions ajoutées par un clic : restent affichées tant qu'elles sont dans la phrase */
    added: [] as string[],
    editingOffer: false,
  });

  const settled = useDebouncedValue(phrase.trim(), SUGGEST_DELAY);
  const lang = locale.startsWith('fr') ? 'fr' : 'en';

  // nom, zone et précisions : réponse rapide (~1 s) ; activités : réponse approfondie (5 à 10 s), à part
  const target = useQuery({
    queryKey: ['lm-suggest-target', settled, lang],
    enabled: settled.length >= 3,
    queryFn: async () => {
      const result = await suggestTargetAction({
        phrase: settled.slice(0, SUGGEST_MAX),
        locale: lang,
      });

      if (!result?.data) {
        throw new Error(result?.serverError ?? 'suggest failed');
      }

      return result.data;
    },
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const activities = useQuery({
    queryKey: ['lm-suggest-activities', settled, lang],
    enabled: settled.length >= 3,
    queryFn: async () => {
      const result = await suggestActivitiesAction({
        phrase: settled.slice(0, SUGGEST_MAX),
        locale: lang,
      });

      if (!result?.data) {
        throw new Error(result?.serverError ?? 'suggest failed');
      }

      return result.data;
    },
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const proposed = useSuggestedCategories(
    activities.data?.categories,
    props.categoryLimit,
  );

  usePlacesFromPhrase(
    target.data && !target.isPlaceholderData ? target.data.places : undefined,
    settled,
    props.editing,
  );

  useAutoName({
    editing: props.editing,
    phrase,
    settled,
    aiName: target.isError
      ? ''
      : target.data && !target.isPlaceholderData
        ? target.data.name
        : null,
  });

  const typing = phrase.trim().length >= 3 && phrase.trim() !== settled;
  const updating = typing || target.isFetching;
  const suggestingActivities = typing || activities.isFetching;

  const chips = [
    ...new Set([
      ...state.added.filter((item) => hasRefinement(phrase, item)),
      ...(settled.length >= 3 ? (target.data?.refinements ?? []) : []),
    ]),
  ].slice(0, MAX_CHIPS);

  const setPhrase = (value: string) => {
    form.setValue('sortTarget', value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  };

  const toggleChip = (item: string) => {
    if (hasRefinement(phrase, item)) {
      setPhrase(removeRefinement(phrase, item));

      return;
    }

    setPhrase(addRefinement(phrase, item));
    setState((current) => ({
      ...current,
      added: [...new Set([...current.added, item])],
    }));
  };

  const storedOffer = (props.spaceOffers[spaceId] ?? '').trim();
  // offre du formulaire vide (dossier sans offre au premier affichage) : le champ reste visible
  const showOfferInput =
    state.editingOffer || storedOffer.length === 0 || offer.trim().length === 0;

  return (
    <Card className={'overflow-visible'} data-test={'campaign-who'}>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey={'campaigns.form.who.title'} />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey={'campaigns.form.who.description'} />
        </CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-6'}>
        <div className={'flex flex-col gap-3'}>
          <FormField
            name={'sortTarget'}
            render={({ field }) => (
              <FormItem>
                <FormLabel className={'sr-only'}>
                  <Trans i18nKey={'campaigns.form.who.title'} />
                </FormLabel>

                <FormControl>
                  <Textarea
                    data-test={'campaign-target-input'}
                    rows={2}
                    maxLength={SORT_TARGET_MAX}
                    placeholder={t('placeholder')}
                    className={'min-h-16 resize-none text-base'}
                    name={field.name}
                    ref={field.ref}
                    value={field.value ?? ''}
                    onBlur={field.onBlur}
                    onChange={(event) => setPhrase(event.target.value)}
                  />
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />

          <div
            className={'flex min-h-7 flex-wrap items-center gap-2'}
            aria-live={'polite'}
            data-test={'campaign-target-refinements'}
          >
            {chips.map((item) => {
              const on = hasRefinement(phrase, item);

              return (
                <Button
                  key={item}
                  type={'button'}
                  variant={'chip'}
                  aria-pressed={on}
                  data-test={'campaign-target-refinement'}
                  onClick={() => toggleChip(item)}
                >
                  {on ? <Check /> : <Plus />}
                  {item}
                </Button>
              );
            })}

            {updating ? (
              <span
                className={
                  'text-muted-foreground flex items-center gap-1.5 text-xs'
                }
              >
                <Spinner className={'size-3'} />
                <Trans i18nKey={'campaigns.form.who.updating'} />
              </span>
            ) : null}
          </div>
        </div>

        <CategoriesSection
          limit={props.categoryLimit}
          suggesting={suggestingActivities}
          proposed={proposed}
        />

        {showOfferInput ? (
          <FormField
            name={'offer'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'campaigns.form.who.offerLabel'} />
                </FormLabel>

                <FormControl>
                  <Input
                    data-test={'campaign-offer-input'}
                    maxLength={OFFER_MAX}
                    placeholder={t('offerPlaceholder')}
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>

                <FormDescription>
                  <Trans i18nKey={'campaigns.form.who.offerHint'} />
                </FormDescription>

                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <p
            className={'text-muted-foreground text-sm'}
            data-test={'campaign-offer-line'}
          >
            <Trans i18nKey={'campaigns.form.who.offerLine'} />{' '}
            <span>{offer}</span>
            <span aria-hidden>{' · '}</span>
            <button
              type={'button'}
              className={'text-brand cursor-pointer hover:underline'}
              data-test={'campaign-offer-edit'}
              onClick={() =>
                setState((current) => ({ ...current, editingOffer: true }))
              }
            >
              <Trans i18nKey={'campaigns.form.who.offerEdit'} />
            </button>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * « On cherchera » : pré-rempli avec les activités proposées d'après la phrase, tant que le client n'a rien
 * choisi lui-même (liste vide, ou encore celle posée ici). Dès qu'il ajoute ou retire une activité, on n'y
 * touche plus : c'est lui qui choisit ses activités (règle n°10).
 *
 * useEffect justifié : recopier dans le formulaire le résultat d'une requête asynchrone quand il arrive.
 */
function useSuggestedCategories(
  suggested:
    | Array<{
        gcid: string;
        label_fr: string;
        label_en: string;
        family: string;
      }>
    | undefined,
  limit: number,
) {
  const locale = useLocale();
  const { getValues, setValue, formState } =
    useFormContext<CampaignFormValues>();
  const autoKey = useRef<string | null>(null);
  const submitted = formState.isSubmitted;
  // sélection faite à la main avant ces propositions : rien n'est remplacé, on propose seulement d'ajouter
  const [proposed, setProposed] = useState<CampaignFormValues['categories']>(
    [],
  );

  useEffect(() => {
    if (!suggested || suggested.length === 0) {
      setProposed([]);

      return;
    }

    const next = suggested.slice(0, limit).map((category) => ({
      gcid: category.gcid,
      label: locale.startsWith('fr') ? category.label_fr : category.label_en,
      family: category.family,
    }));

    const current = getValues('categories') ?? [];
    const currentKey = current.map((category) => category.gcid).join(',');

    if (current.length > 0 && currentKey !== autoKey.current) {
      setProposed(next);

      return;
    }

    setProposed([]);
    autoKey.current = next.map((category) => category.gcid).join(',');

    setValue('categories', next, {
      shouldDirty: true,
      shouldValidate: submitted,
    });
  }, [suggested, limit, locale, getValues, setValue, submitted]);

  return proposed;
}

/**
 * Villes citées dans la phrase (« Restaurants à Lyon et Villeurbanne ») : reportées dans « Où ? » (pays, puis les
 * villes en « Villes précises »), tant que le client n'a pas choisi sa zone lui-même : zone jamais touchée, ou
 * encore celle posée ici d'après une phrase précédente (elle suit alors la nouvelle phrase). Jamais en
 * modification (le pays d'une campagne lancée est figé).
 *
 * useEffect justifié : recopier dans le formulaire le résultat de requêtes asynchrones (IA puis villes).
 */
function usePlacesFromPhrase(
  places: { cities: string[]; countryCode: string | null } | null | undefined,
  settled: string,
  editing: boolean,
) {
  const { getValues, setValue } = useFormContext<CampaignFormValues>();
  const applied = useRef<{ phrase: string | null; cities: string | null }>({
    phrase: null,
    cities: null,
  });

  useEffect(() => {
    if (editing || places === undefined || applied.current.phrase === settled) {
      return;
    }

    const currentCities = (getValues('cities') ?? [])
      .map((city) => city.geonameId)
      .join(',');
    const untouched =
      getValues('citiesMode') === 'country' &&
      currentCities === '' &&
      !getValues('radiusCity');
    const ours =
      getValues('citiesMode') === 'list' &&
      applied.current.cities !== null &&
      currentCities === applied.current.cities;

    if (!untouched && !ours) {
      return;
    }

    applied.current.phrase = settled;

    // plus de ville dans la phrase : la zone posée ici revient à « Tout le pays »
    if (!places) {
      if (ours) {
        setValue('citiesMode', 'country', { shouldDirty: true });
        setValue('cities', [], { shouldDirty: true });
        applied.current.cities = null;
      }

      return;
    }

    const countryCode = places.countryCode ?? getValues('countryCode');

    void Promise.all(
      places.cities.map((city) =>
        searchCitiesAction({ countryCode, query: city }).then(
          (result) => result?.data?.[0] ?? null,
        ),
      ),
    ).then((found) => {
      const cities = found.filter(
        (city): city is NonNullable<typeof city> => city !== null,
      );

      if (cities.length === 0 || applied.current.phrase !== settled) {
        return;
      }

      if (countryCode !== getValues('countryCode')) {
        setValue('countryCode', countryCode, { shouldValidate: true });
        setValue('radiusCity', null);
      }

      const unique = [
        ...new Map(cities.map((city) => [city.geonameId, city])).values(),
      ];

      applied.current.cities = unique.map((city) => city.geonameId).join(',');
      setValue('citiesMode', 'list', { shouldDirty: true });
      setValue('cities', unique, { shouldDirty: true, shouldValidate: true });
    });
  }, [places, settled, editing, getValues, setValue]);
}

/**
 * Nom de la campagne proposé tant que le client ne l'a pas tapé lui-même : le nom court donné par l'IA d'après la
 * phrase (« Restaurants indépendants »), sinon le début de la phrase ; sans phrase, les activités choisies
 * (« Restaurant, Pizzeria et 12 autres »). Il suit chaque changement de la phrase ou des activités. En modification,
 * le nom enregistré ne change que si la phrase change.
 *
 * useEffect justifié : recopier dans le formulaire un nom qui dépend d'une requête asynchrone (l'IA).
 */
function useAutoName(params: {
  editing: boolean;
  phrase: string;
  settled: string;
  /** nom de l'IA pour la phrase actuelle ; '' si l'IA n'en donne pas ; null en attendant */
  aiName: string | null;
}) {
  const t = useTranslations('campaigns.form.who');
  const { getFieldState, setValue, getValues, formState } =
    useFormContext<CampaignFormValues>();
  const watched = useWatch({ name: 'categories' }) as
    | CampaignFormValues['categories']
    | undefined;
  const categoriesKey = (watched ?? []).map((c) => c.gcid).join(',');
  const initial = useRef({ phrase: params.phrase.trim() });
  const submitted = formState.isSubmitted;
  const phrase = params.phrase.trim();

  useEffect(() => {
    if (getFieldState('name').isDirty) {
      return;
    }

    // modification : le nom enregistré (peut-être tapé par le client) ne change que si la phrase change
    if (params.editing && phrase === initial.current.phrase) {
      return;
    }

    const categories = getValues('categories') ?? [];
    let next: string | null = null;

    if (phrase.length > 0) {
      // le nom de l'IA arrive ~1 s après la frappe : on garde l'ancien nom en attendant
      if (params.settled === phrase && params.aiName !== null) {
        next = params.aiName || firstClause(phrase);
      }
    } else if (categories.length > 0) {
      const shown = categories
        .slice(0, AUTO_NAME_ACTIVITIES)
        .map((c) => c.label)
        .join(', ');
      const rest = categories.length - AUTO_NAME_ACTIVITIES;

      next =
        rest > 0 ? t('autoNameMore', { names: shown, count: rest }) : shown;
    } else {
      next = '';
    }

    if (next !== null && next !== getValues('name')) {
      setValue('name', next.slice(0, AUTO_NAME_MAX), {
        shouldValidate: submitted,
      });
    }
  }, [
    phrase,
    params.settled,
    params.aiName,
    params.editing,
    categoriesKey,
    getFieldState,
    getValues,
    setValue,
    submitted,
    t,
  ]);
}

/** Début de la phrase, jusqu'à la première virgule (« Restaurants, sans les chaînes… » → « Restaurants »). */
function firstClause(phrase: string) {
  const head = phrase.split(/[,;.:(]/)[0]?.trim() ?? '';

  return head.length > 0 ? head : phrase;
}

function hasRefinement(phrase: string, item: string) {
  return phrase.toLowerCase().includes(item.toLowerCase());
}

/** Ajoute un bout de phrase à la cible : « Agences marketing, sans celles qui font du web ». */
function addRefinement(phrase: string, item: string) {
  const base = phrase.trim().replace(/[\s,;.]+$/, '');

  return base.length > 0 ? `${base}, ${item}` : item;
}

/** Retire un bout de phrase ajouté (et la virgule qui le précède). */
function removeRefinement(phrase: string, item: string) {
  const start = phrase.toLowerCase().indexOf(item.toLowerCase());

  if (start === -1) {
    return phrase;
  }

  const before = phrase.slice(0, start).replace(/[\s,;]+$/, '');
  const after = phrase.slice(start + item.length).replace(/^[\s,;]+/, '');

  return [before, after].filter(Boolean).join(', ');
}
