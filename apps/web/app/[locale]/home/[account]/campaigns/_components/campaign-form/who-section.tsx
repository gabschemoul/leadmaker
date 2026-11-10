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
import { cn } from '@kit/ui/utils';

import {
  type CampaignFormValues,
  OFFER_MAX,
  SORT_TARGET_MAX,
} from '../../_lib/schema/campaign.schema';
import { suggestTargetAction } from '../../_lib/server/ai-actions';
import { useDebouncedValue } from '../../_lib/use-debounced-value';
import { CategoriesSection } from './categories-section';

/** Pause de frappe avant de proposer des précisions et des activités. */
const SUGGEST_DELAY = 1000;

/** Longueur de phrase acceptée par suggestTargetAction. */
const SUGGEST_MAX = 300;

/** Puces affichées au plus. */
const MAX_CHIPS = 8;

/** Nom de campagne tiré de la phrase, tant que le client ne l'a pas changé. */
const AUTO_NAME_MAX = 80;

export function WhoSection(props: {
  categoryLimit: number;
  /** « Votre offre » enregistrée pour chaque dossier (vide si aucune) */
  spaceOffers: Record<string, string>;
  /** le nom de la campagne suit la phrase tant que le client ne l'a pas touché (création seulement) */
  autoName: boolean;
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

  const suggestions = useQuery({
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

  useSuggestedCategories(suggestions.data?.categories, props.categoryLimit);

  const updating =
    phrase.trim().length >= 3 &&
    (phrase.trim() !== settled || suggestions.isFetching);

  const chips = [
    ...new Set([
      ...state.added.filter((item) => hasRefinement(phrase, item)),
      ...(settled.length >= 3 ? (suggestions.data?.refinements ?? []) : []),
    ]),
  ].slice(0, MAX_CHIPS);

  const setPhrase = (value: string) => {
    form.setValue('sortTarget', value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });

    if (props.autoName && !form.getFieldState('name').isDirty) {
      form.setValue('name', value.trim().slice(0, AUTO_NAME_MAX), {
        shouldValidate: form.formState.isSubmitted,
      });
    }
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
  const showOfferInput = state.editingOffer || storedOffer.length === 0;

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
                  size={'sm'}
                  variant={'outline'}
                  aria-pressed={on}
                  data-test={'campaign-target-refinement'}
                  className={cn(
                    'rounded-full font-normal',
                    on &&
                      'border-brand/30 bg-brand-pale text-brand hover:bg-brand-pale hover:text-brand',
                  )}
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

        <CategoriesSection limit={props.categoryLimit} />

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
    | Array<{ gcid: string; label_fr: string; label_en: string }>
    | undefined,
  limit: number,
) {
  const locale = useLocale();
  const { getValues, setValue, formState } =
    useFormContext<CampaignFormValues>();
  const autoKey = useRef<string | null>(null);
  const submitted = formState.isSubmitted;

  useEffect(() => {
    if (!suggested || suggested.length === 0) {
      return;
    }

    const current = getValues('categories') ?? [];
    const currentKey = current.map((category) => category.gcid).join(',');

    if (current.length > 0 && currentKey !== autoKey.current) {
      return;
    }

    const next = suggested.slice(0, limit).map((category) => ({
      gcid: category.gcid,
      label: locale.startsWith('fr') ? category.label_fr : category.label_en,
    }));

    autoKey.current = next.map((category) => category.gcid).join(',');

    setValue('categories', next, {
      shouldDirty: true,
      shouldValidate: submitted,
    });
  }, [suggested, limit, locale, getValues, setValue, submitted]);
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
