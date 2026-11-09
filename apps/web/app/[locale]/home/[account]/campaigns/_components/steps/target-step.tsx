import Link from 'next/link';

import { ArrowRight, Pencil } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

import type { loadCampaignForEdit } from '../../_lib/server/campaigns.loader';

const CHIPS_PREVIEW = 24;

type CampaignForEdit = NonNullable<
  Awaited<ReturnType<typeof loadCampaignForEdit>>
>;

/**
 * Étape 1, « Qui ? » : le résumé du ciblage (cible en mots, où, quelles
 * activités, quels filtres) et le bouton vers le formulaire de modification.
 */
export async function TargetStep(props: {
  campaign: CampaignForEdit;
  countryLabel: string;
  editHref: string;
  nextHref: string;
}) {
  const t = await getTranslations('campaigns.steps.target');
  const { campaign } = props;

  const targeting = (campaign.targeting ?? {}) as {
    cities?: {
      mode?: string;
      min_population?: number;
      radius_km?: number;
    };
    categories?: { mode?: string };
  };

  const filters = (campaign.filters ?? {}) as {
    rating_min?: number;
    rating_max?: number;
    min_reviews?: number;
    website?: string;
    exclude_public?: boolean;
    main_category_only?: boolean;
    extra_exclusions?: string[];
  };

  const citiesMode = targeting.cities?.mode ?? 'country';
  const categoriesMode = targeting.categories?.mode ?? 'generic';

  const where =
    citiesMode === 'radius'
      ? t('modeRadius', {
          city: campaign.cities[0]?.name ?? '',
          km: targeting.cities?.radius_km ?? 30,
        })
      : citiesMode === 'list'
        ? t('modeList', { count: campaign.cities.length })
        : (targeting.cities?.min_population ?? 0) > 0
          ? t('modeCountryMin', { min: targeting.cities?.min_population ?? 0 })
          : t('modeCountry');

  const what =
    categoriesMode === 'list'
      ? t('catList', { count: campaign.categories.length })
      : categoriesMode === 'all'
        ? t('catAll')
        : t('catGeneric');

  const filterLines = [
    t('website', { value: filters.website ?? 'all' }),
    filters.rating_min !== undefined && filters.rating_max !== undefined
      ? t('rating', { min: filters.rating_min, max: filters.rating_max })
      : null,
    filters.min_reviews
      ? t('minReviews', { count: filters.min_reviews })
      : null,
    filters.exclude_public ? t('excludePublic') : null,
    filters.main_category_only ? t('mainCategoryOnly') : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <div className={'flex flex-col gap-4'} data-test={'campaign-step-target'}>
      {campaign.sort_target ? (
        <Card data-test={'campaign-target-phrase'}>
          <CardHeader>
            <CardTitle>{t('whoTitle')}</CardTitle>
            <CardDescription className={'text-foreground'}>
              {campaign.sort_target}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('whereTitle')}</CardTitle>
          <CardDescription>
            {props.countryLabel} · {where}
          </CardDescription>
        </CardHeader>

        {citiesMode === 'list' ? (
          <CardContent>
            <Chips
              items={campaign.cities.map((city) => city.name)}
              more={t('more', {
                count: Math.max(0, campaign.cities.length - CHIPS_PREVIEW),
              })}
            />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('whatTitle')}</CardTitle>
          <CardDescription>{what}</CardDescription>
        </CardHeader>

        {categoriesMode === 'list' ? (
          <CardContent>
            <Chips
              items={campaign.categories.map((category) => category.label)}
              more={t('more', {
                count: Math.max(0, campaign.categories.length - CHIPS_PREVIEW),
              })}
            />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('filtersTitle')}</CardTitle>
          <CardDescription>{filterLines.join(' · ')}</CardDescription>
        </CardHeader>
      </Card>

      {campaign.launched ? (
        <p className={'text-muted-foreground text-sm'}>{t('launchedHint')}</p>
      ) : null}

      <div className={'flex flex-wrap justify-end gap-2'}>
        <Button
          variant={'outline'}
          nativeButton={false}
          data-test={'campaign-edit-button'}
          render={<Link href={props.editHref} />}
        >
          <Pencil className={'w-4'} />
          <span>{t('edit')}</span>
        </Button>

        <Button
          nativeButton={false}
          data-test={'campaign-step-next'}
          render={<Link href={props.nextHref} />}
        >
          <span>
            <Trans i18nKey={'campaigns.steps.trouver'} />
          </span>
          <ArrowRight className={'w-4'} />
        </Button>
      </div>
    </div>
  );
}

function Chips(props: { items: string[]; more: string }) {
  const visible = props.items.slice(0, CHIPS_PREVIEW);

  return (
    <div className={'flex flex-wrap gap-1.5'}>
      {visible.map((item) => (
        <Badge key={item} variant={'secondary'} className={'font-normal'}>
          {item}
        </Badge>
      ))}

      {props.items.length > CHIPS_PREVIEW ? (
        <span className={'text-muted-foreground self-center text-xs'}>
          {props.more}
        </span>
      ) : null}
    </div>
  );
}
