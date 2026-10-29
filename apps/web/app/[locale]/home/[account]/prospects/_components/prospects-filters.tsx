'use client';

import { useRouter } from 'next/navigation';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';
import { Trans } from '@kit/ui/trans';

import {
  type ProspectsFilters as Filters,
  type ProspectsListState,
  buildProspectsHref,
  countActiveFilters,
} from '~/lib/leadmaker/prospects-query';

import { FacetMultiSelect } from './facet-multi-select';

const RATING_STEPS = [1, 2, 3, 4, 5];
const REVIEWS_STEPS = [1, 5, 10, 20, 50, 100];

interface Facet {
  value: string;
  total: number;
}

/**
 * Barre de filtres de la page Prospects. Tout passe par l'URL : chaque
 * changement navigue vers la nouvelle adresse (partageable), et les champs
 * reflètent l'état lu par le serveur.
 */
export function ProspectsFilters(props: {
  basePath: string;
  state: ProspectsListState;
  /** vide quand l'organisation n'a qu'un dossier client : pas de sélecteur */
  folders: Array<{ id: string; label: string }>;
  spaceId: string;
  campaigns: Array<{ id: string; name: string; total: number }>;
  categories: Facet[];
  cities: Facet[];
}) {
  const t = useTranslations('prospects');
  const router = useRouter();
  const { filters } = props.state;
  const space = props.folders.length > 1 ? props.spaceId : undefined;

  const navigate = (patch: Partial<Filters>) => {
    router.push(
      buildProspectsHref(props.basePath, {
        space,
        sort: props.state.sort,
        dir: props.state.dir,
        page: 1,
        filters: { ...filters, ...patch },
      }),
    );
  };

  const reset = () =>
    router.push(buildProspectsHref(props.basePath, { space }));

  const changeFolder = (spaceId: string) =>
    router.push(buildProspectsHref(props.basePath, { space: spaceId }));

  const number = (value: string) => (value === '' ? undefined : Number(value));

  const campaignName = (id: string) =>
    props.campaigns.find((campaign) => campaign.id === id)?.name ?? id;

  const activeCount = countActiveFilters(filters);

  return (
    <div className={'flex flex-col gap-3'} data-test={'prospects-filters'}>
      <div className={'flex flex-wrap items-center gap-2'}>
        {props.folders.length > 1 ? (
          <NativeSelect
            size={'sm'}
            aria-label={t('filters.folder')}
            data-test={'prospects-folder-select'}
            value={props.spaceId}
            onChange={(event) => changeFolder(event.target.value)}
          >
            {props.folders.map((folder) => (
              <NativeSelectOption key={folder.id} value={folder.id}>
                {folder.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}

        <form
          // remonte le champ quand l'URL change, pour resynchroniser sa valeur
          key={filters.query ?? ''}
          className={'flex items-center gap-1'}
          onSubmit={(event) => {
            event.preventDefault();

            const data = new FormData(event.currentTarget);
            const query = String(data.get('q') ?? '').trim();

            navigate({ query: query || undefined });
          }}
        >
          <Input
            name={'q'}
            type={'search'}
            className={'h-7 w-48 text-[0.8rem] md:w-64'}
            data-test={'prospects-search-input'}
            defaultValue={filters.query ?? ''}
            placeholder={t('filters.searchPlaceholder')}
            maxLength={100}
          />

          <Button
            type={'submit'}
            size={'icon-sm'}
            variant={'secondary'}
            aria-label={t('filters.searchButton')}
            data-test={'prospects-search-button'}
          >
            <Search className={'w-4'} />
          </Button>
        </form>

        <NativeSelect
          size={'sm'}
          aria-label={t('filters.campaign')}
          data-test={'prospects-campaign-select'}
          value={filters.campaign ?? ''}
          onChange={(event) =>
            navigate({ campaign: event.target.value || undefined })
          }
        >
          <NativeSelectOption value={''}>
            {t('filters.campaignAll')}
          </NativeSelectOption>

          {props.campaigns.map((campaign) => (
            <NativeSelectOption key={campaign.id} value={campaign.id}>
              {campaign.name} ({campaign.total})
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <FacetMultiSelect
          label={t('filters.category')}
          options={props.categories}
          selected={filters.categories}
          onChange={(categories) => navigate({ categories })}
          searchPlaceholder={t('filters.searchValues')}
          emptyLabel={t('filters.noValues')}
          data-test={'prospects-category-filter'}
        />

        <FacetMultiSelect
          label={t('filters.city')}
          options={props.cities}
          selected={filters.cities}
          onChange={(cities) => navigate({ cities })}
          searchPlaceholder={t('filters.searchValues')}
          emptyLabel={t('filters.noValues')}
          data-test={'prospects-city-filter'}
        />

        <NativeSelect
          size={'sm'}
          aria-label={t('filters.ratingMin')}
          data-test={'prospects-rating-min'}
          value={filters.ratingMin ?? ''}
          onChange={(event) =>
            navigate({ ratingMin: number(event.target.value) })
          }
        >
          <NativeSelectOption value={''}>
            {t('filters.ratingMin')}
          </NativeSelectOption>

          {withCurrent(RATING_STEPS, filters.ratingMin).map((value) => (
            <NativeSelectOption key={value} value={value}>
              {t('filters.ratingAtLeast', { value })}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <NativeSelect
          size={'sm'}
          aria-label={t('filters.ratingMax')}
          data-test={'prospects-rating-max'}
          value={filters.ratingMax ?? ''}
          onChange={(event) =>
            navigate({ ratingMax: number(event.target.value) })
          }
        >
          <NativeSelectOption value={''}>
            {t('filters.ratingMax')}
          </NativeSelectOption>

          {withCurrent(RATING_STEPS, filters.ratingMax).map((value) => (
            <NativeSelectOption key={value} value={value}>
              {t('filters.ratingAtMost', { value })}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <NativeSelect
          size={'sm'}
          aria-label={t('filters.reviewsMin')}
          data-test={'prospects-reviews-min'}
          value={filters.reviewsMin ?? ''}
          onChange={(event) =>
            navigate({ reviewsMin: number(event.target.value) })
          }
        >
          <NativeSelectOption value={''}>
            {t('filters.reviewsMin')}
          </NativeSelectOption>

          {withCurrent(REVIEWS_STEPS, filters.reviewsMin).map((value) => (
            <NativeSelectOption key={value} value={value}>
              {t('filters.reviewsAtLeast', { count: value })}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <NativeSelect
          size={'sm'}
          aria-label={t('filters.website')}
          data-test={'prospects-website-select'}
          value={filters.website ?? ''}
          onChange={(event) =>
            navigate({
              website: (event.target.value || undefined) as Filters['website'],
            })
          }
        >
          <NativeSelectOption value={''}>
            {t('filters.websiteAll')}
          </NativeSelectOption>

          <NativeSelectOption value={'with'}>
            {t('filters.websiteWith')}
          </NativeSelectOption>

          <NativeSelectOption value={'without'}>
            {t('filters.websiteWithout')}
          </NativeSelectOption>
        </NativeSelect>

        <NativeSelect
          size={'sm'}
          aria-label={t('filters.source')}
          data-test={'prospects-source-select'}
          value={filters.source ?? ''}
          onChange={(event) =>
            navigate({
              source: (event.target.value || undefined) as Filters['source'],
            })
          }
        >
          <NativeSelectOption value={''}>
            {t('filters.sourceAll')}
          </NativeSelectOption>

          <NativeSelectOption value={'maps'}>
            {t('source.maps')}
          </NativeSelectOption>

          <NativeSelectOption value={'csv'}>
            {t('source.csv')}
          </NativeSelectOption>
        </NativeSelect>

        <NativeSelect
          size={'sm'}
          aria-label={t('filters.status')}
          data-test={'prospects-status-select'}
          value={filters.status}
          onChange={(event) =>
            navigate({ status: event.target.value as Filters['status'] })
          }
        >
          <NativeSelectOption value={'active'}>
            {t('filters.statusActive')}
          </NativeSelectOption>

          <NativeSelectOption value={'excluded'}>
            {t('filters.statusExcluded')}
          </NativeSelectOption>

          <NativeSelectOption value={'all'}>
            {t('filters.statusAll')}
          </NativeSelectOption>
        </NativeSelect>
      </div>

      {activeCount > 0 ? (
        <div
          className={'flex flex-wrap items-center gap-1.5'}
          data-test={'prospects-active-filters'}
        >
          {filters.query ? (
            <FilterBadge
              label={t('badges.search', { value: filters.query })}
              onRemove={() => navigate({ query: undefined })}
            />
          ) : null}

          {filters.campaign ? (
            <FilterBadge
              label={t('badges.campaign', {
                value: campaignName(filters.campaign),
              })}
              onRemove={() => navigate({ campaign: undefined })}
            />
          ) : null}

          {filters.categories.map((category) => (
            <FilterBadge
              key={`cat-${category}`}
              label={t('badges.category', { value: category })}
              onRemove={() =>
                navigate({
                  categories: filters.categories.filter((c) => c !== category),
                })
              }
            />
          ))}

          {filters.cities.map((city) => (
            <FilterBadge
              key={`city-${city}`}
              label={t('badges.city', { value: city })}
              onRemove={() =>
                navigate({ cities: filters.cities.filter((c) => c !== city) })
              }
            />
          ))}

          {filters.ratingMin !== undefined ? (
            <FilterBadge
              label={t('badges.ratingMin', { value: filters.ratingMin })}
              onRemove={() => navigate({ ratingMin: undefined })}
            />
          ) : null}

          {filters.ratingMax !== undefined ? (
            <FilterBadge
              label={t('badges.ratingMax', { value: filters.ratingMax })}
              onRemove={() => navigate({ ratingMax: undefined })}
            />
          ) : null}

          {filters.reviewsMin !== undefined ? (
            <FilterBadge
              label={t('badges.reviewsMin', { count: filters.reviewsMin })}
              onRemove={() => navigate({ reviewsMin: undefined })}
            />
          ) : null}

          {filters.website ? (
            <FilterBadge
              label={t(
                filters.website === 'with'
                  ? 'filters.websiteWith'
                  : 'filters.websiteWithout',
              )}
              onRemove={() => navigate({ website: undefined })}
            />
          ) : null}

          {filters.source ? (
            <FilterBadge
              label={t('badges.source', {
                value: t(`source.${filters.source}`),
              })}
              onRemove={() => navigate({ source: undefined })}
            />
          ) : null}

          {filters.status !== 'active' ? (
            <FilterBadge
              label={t(
                filters.status === 'excluded'
                  ? 'filters.statusExcluded'
                  : 'filters.statusAll',
              )}
              onRemove={() => navigate({ status: 'active' })}
            />
          ) : null}

          <Button
            size={'sm'}
            variant={'ghost'}
            data-test={'prospects-reset-filters'}
            onClick={reset}
          >
            <Trans i18nKey={'prospects.filters.reset'} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Garde la valeur courante dans la liste si elle vient d'une URL inhabituelle. */
function withCurrent(steps: number[], current: number | undefined) {
  if (current === undefined || steps.includes(current)) return steps;

  return [...steps, current].sort((a, b) => a - b);
}

function FilterBadge(props: { label: string; onRemove: () => void }) {
  const t = useTranslations('prospects');

  return (
    <Badge
      variant={'secondary'}
      className={'gap-1 pr-1'}
      data-test={'prospects-filter-badge'}
    >
      <span>{props.label}</span>

      <button
        type={'button'}
        className={'hover:bg-foreground/10 rounded-full p-0.5'}
        aria-label={t('filters.remove')}
        data-test={'prospects-filter-remove'}
        onClick={props.onRemove}
      >
        <X className={'size-3'} />
      </button>
    </Badge>
  );
}
