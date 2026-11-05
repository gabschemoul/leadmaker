'use client';

/**
 * Rôle : résumé « ce que la campagne va chercher » affiché avant le bouton d'enregistrement.
 * Données : valeurs du formulaire react-hook-form parent (useWatch).
 * Écritures : aucune.
 */

import { useTranslations } from 'next-intl';
import { useWatch } from 'react-hook-form';

import { Alert, AlertDescription } from '@kit/ui/alert';

import type {
  CategoryRef,
  CampaignFormValues,
  CityRef,
} from '../../_lib/schema/campaign.schema';

/**
 * Résumé en une phrase de ce que la campagne va chercher, juste avant le
 * bouton d'enregistrement : on voit tout de suite un ciblage qui ne
 * correspond pas à l'intention (activités, villes).
 */
export function CampaignRecap() {
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
