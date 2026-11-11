'use client';

/**
 * Rôle : section « Activités » du formulaire de campagne (recherche, catalogue par famille, « Tout sélectionner »).
 * Écran « Qui ? » : affichée dans la carte de la cible, sous le titre « On cherchera » (pré-remplie d'après la
 * phrase par WhoSection tant que le client n'a rien choisi lui-même).
 * Données : searchCategoriesAction / listAllCategoriesAction (lm_categories) ; valeurs dans le formulaire parent.
 * Écritures : aucune en base (modifie seulement le champ `categories` du formulaire).
 */

import { useState } from 'react';

import { ListTree, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useFormContext } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { If } from '@kit/ui/if';
import { Spinner } from '@kit/ui/spinner';
import { Trans } from '@kit/ui/trans';

import {
  type CategoryRef,
  type CampaignFormValues,
  MAX_CATEGORIES,
} from '../../_lib/schema/campaign.schema';
import {
  listAllCategoriesAction,
  searchCategoriesAction,
} from '../../_lib/server/category-actions';
import { CategoryBrowserDialog } from '../category-browser-dialog';
import { SearchPicker } from '../search-picker';
import { ChipList, SelectedChip } from './form-controls';

/** Activités affichées en étiquettes au départ, puis par paquets avec « Afficher plus » (retour du 11/11). */
const CATEGORY_CHIPS_STEP = 40;

export function CategoriesSection(props: {
  limit: number;
  /** l'IA cherche les activités d'après la phrase */
  suggesting?: boolean;
  /** activités proposées par l'IA qui manquent à une sélection faite à la main (jamais ajoutées d'office) */
  proposed?: CategoryRef[];
}) {
  const t = useTranslations('campaigns');
  const locale = useLocale();
  const [browsing, setBrowsing] = useState(false);
  const [shown, setShown] = useState(CATEGORY_CHIPS_STEP);
  // taille du catalogue, connue après un « Tout sélectionner »
  const [catalogSize, setCatalogSize] = useState<number | null>(null);
  const { setValue } = useFormContext<CampaignFormValues>();
  const unlimited = props.limit > MAX_CATEGORIES;

  const selectAll = useAction(listAllCategoriesAction, {
    onSuccess: ({ data }) => {
      if (!data) {
        return;
      }

      setCatalogSize(data.length);
      setValue(
        'categories',
        data.map((category) => ({
          gcid: category.gcid,
          label: locale.startsWith('fr') ? category.labelFr : category.labelEn,
          family: category.family,
        })),
        { shouldDirty: true, shouldValidate: true },
      );
    },
  });

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
    <FormField
      name={'categories'}
      render={({ field }) => {
        const categories = (field.value ?? []) as CategoryRef[];
        const selectedIds = new Set(categories.map((c) => c.gcid));
        const proposedMissing = (props.proposed ?? []).filter(
          (c) => !selectedIds.has(c.gcid),
        );
        const allSelected =
          catalogSize !== null && categories.length >= catalogSize;

        return (
          <FormItem>
            <div
              className={'flex flex-wrap items-center justify-between gap-2'}
            >
              <FormLabel className={'flex items-center gap-2'}>
                <Trans i18nKey={'campaigns.form.who.searchLabel'} />
                {props.suggesting ? (
                  <Spinner
                    className={'size-3.5'}
                    data-test={'campaign-categories-suggesting'}
                  />
                ) : null}
              </FormLabel>

              <div className={'flex flex-wrap items-center gap-2'}>
                <If condition={unlimited}>
                  <Button
                    type={'button'}
                    size={'sm'}
                    variant={'outline'}
                    disabled={selectAll.isPending}
                    data-test={'campaign-categories-select-all'}
                    onClick={() => {
                      if (allSelected) {
                        field.onChange([]);
                      } else {
                        selectAll.execute();
                      }
                    }}
                  >
                    {selectAll.isPending ? (
                      <Spinner className={'mr-1.5 size-4'} />
                    ) : null}

                    <Trans
                      i18nKey={
                        allSelected
                          ? 'campaigns.form.categoriesDeselectAll'
                          : 'campaigns.form.categoriesSelectAll'
                      }
                    />
                  </Button>
                </If>

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
            </div>

            <If condition={selectAll.result.serverError}>
              {(message) => (
                <p className={'text-destructive text-sm'}>
                  <Trans i18nKey={message} />
                </p>
              )}
            </If>

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
                  if (
                    categories.length < props.limit &&
                    !categories.some((c) => c.gcid === item.gcid)
                  ) {
                    field.onChange([...categories, item]);
                  }
                }}
                placeholder={t('form.categorySearchPlaceholder')}
              />
            </FormControl>

            <If condition={categories.length > 0}>
              <div
                className={'flex items-center justify-between gap-2 text-sm'}
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
              {proposedMissing.length > 0 ? (
                <Button
                  type={'button'}
                  variant={'chip'}
                  data-test={'campaign-categories-add-proposed'}
                  onClick={() =>
                    field.onChange(
                      [...categories, ...proposedMissing].slice(0, props.limit),
                      { shouldValidate: true },
                    )
                  }
                >
                  <Plus />
                  <Trans
                    i18nKey={'campaigns.form.who.addProposed'}
                    values={{ count: proposedMissing.length }}
                  />
                </Button>
              ) : null}

              {categories.slice(0, shown).map((category) => (
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

              <If condition={categories.length > shown}>
                <Button
                  type={'button'}
                  variant={'link'}
                  className={'text-brand h-auto self-center p-0 text-sm'}
                  data-test={'campaign-categories-more'}
                  onClick={() =>
                    setShown((current) => current + CATEGORY_CHIPS_STEP)
                  }
                >
                  <Trans
                    i18nKey={'campaigns.form.categoriesMore'}
                    values={{ count: categories.length - shown }}
                  />
                </Button>
              </If>
            </ChipList>

            <FormMessage />

            <CategoryBrowserDialog
              open={browsing}
              onOpenChange={setBrowsing}
              selected={categories}
              onChange={(next) =>
                field.onChange(next, { shouldValidate: true })
              }
              max={props.limit}
            />
          </FormItem>
        );
      }}
    />
  );
}
