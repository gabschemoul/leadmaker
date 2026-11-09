'use client';

/**
 * Rôle : pli « Plus de critères » du formulaire de campagne, fermé par défaut (note moyenne, nombre d'avis,
 * site web, exclusions ; décision du 9/11 : ces filtres restent, sous « Où ? »).
 * Données : champs du formulaire react-hook-form parent.
 * Écritures : aucune en base.
 */

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Trans } from '@kit/ui/trans';

import { RATING_FLOOR } from '../../_lib/schema/campaign.schema';
import { ChoiceGroup, NumberInput } from './form-controls';

export function FiltersSection(props: {
  /** fermé par défaut ; le formulaire l'ouvre quand un critère est invalide */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');

  return (
    <Collapsible
      render={<Card />}
      open={props.open}
      onOpenChange={(open) => props.onOpenChange(open)}
      data-test={'campaign-more-criteria'}
    >
      <CardHeader>
        <CollapsibleTrigger
          className={
            'group/criteria flex w-full cursor-pointer items-start justify-between gap-3 text-left'
          }
          data-test={'campaign-more-criteria-toggle'}
        >
          <span className={'flex flex-col gap-1.5'}>
            <CardTitle>
              <Trans i18nKey={'campaigns.form.moreCriteriaTitle'} />
            </CardTitle>

            <CardDescription>
              <Trans i18nKey={'campaigns.form.filtersDescription'} />
            </CardDescription>
          </span>

          <ChevronDown
            className={
              'text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform group-data-[panel-open]/criteria:rotate-180'
            }
          />
        </CollapsibleTrigger>
      </CardHeader>

      <CollapsibleContent
        render={<CardContent />}
        className={'flex flex-col gap-4'}
      >
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
      </CollapsibleContent>
    </Collapsible>
  );
}
