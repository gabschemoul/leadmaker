'use client';

import { useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { MapPin, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Spinner } from '@kit/ui/spinner';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { type CityRef } from '../_lib/schema/campaign.schema';
import { nearbyCitiesAction } from '../_lib/server/server-actions';
import { useDebouncedValue } from '../_lib/use-debounced-value';
import { SearchPicker } from './search-picker';

const RADIUS_PRESETS = [5, 10, 15, 20, 30, 50];

type NearbyCity = CityRef & {
  distanceKm: number;
  districtOf: string | null;
};

/**
 * « Lyon et alentours » : on choisit une ville centre et un rayon, on voit
 * toutes les communes autour (cochées par défaut, sauf les arrondissements de
 * la ville centre, déjà couverts) et on les ajoute en un clic.
 */
export function NearbyCitiesDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  countryCode: string;
  initialCenter: CityRef | null;
  existingIds: ReadonlySet<number>;
  /** places restantes dans la liste de la campagne */
  remaining: number;
  searchCities: (query: string) => Promise<CityRef[]>;
  renderCity: (city: CityRef) => React.ReactNode;
  onAdd: (cities: CityRef[]) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className={'flex max-h-[90vh] flex-col sm:max-w-2xl'}
        data-test={'nearby-cities-dialog'}
      >
        {props.open ? (
          // clé : chaque ouverture repart de zéro (centre, rayon, coches)
          <NearbyCitiesBody
            key={props.initialCenter?.geonameId ?? 'none'}
            {...props}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NearbyCitiesBody(props: Parameters<typeof NearbyCitiesDialog>[0]) {
  const t = useTranslations('campaigns');
  const format = useFormatter();

  const [center, setCenter] = useState<CityRef | null>(props.initialCenter);
  const [radiusKm, setRadiusKm] = useState(15);
  const [minPopulation, setMinPopulation] = useState(0);

  const query = {
    radiusKm: useDebouncedValue(radiusKm, 300),
    minPopulation: useDebouncedValue(minPopulation, 300),
    centerId: center?.geonameId ?? null,
  };

  const queryKey = [
    'lm-nearby-cities',
    props.countryCode,
    query.centerId,
    query.radiusKm,
    query.minPopulation,
  ] as const;

  const { data, isFetching, isError } = useQuery({
    queryKey,
    enabled: query.centerId !== null && query.radiusKm >= 1,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await nearbyCitiesAction({
        countryCode: props.countryCode,
        geonameId: query.centerId!,
        radiusKm: Math.min(query.radiusKm, 100),
        minPopulation: query.minPopulation,
      });

      if (!result?.data) {
        throw new Error(result?.serverError ?? 'search failed');
      }

      return result.data as NearbyCity[];
    },
  });

  // coches modifiées à la main, remises à zéro quand la liste change
  const listKey = queryKey.join('|');
  const [toggled, setToggled] = useState({
    key: listKey,
    ids: new Set<number>(),
  });
  const toggledIds = toggled.key === listKey ? toggled.ids : new Set<number>();

  const cities = useMemo(() => data ?? [], [data]);
  const isDefaultChecked = (city: NearbyCity) => city.districtOf === null;

  const isChecked = (city: NearbyCity) =>
    props.existingIds.has(city.geonameId) ||
    isDefaultChecked(city) !== toggledIds.has(city.geonameId);

  const toAdd = cities.filter(
    (city) => !props.existingIds.has(city.geonameId) && isChecked(city),
  );

  const toggle = (city: NearbyCity) => {
    const ids = new Set(toggledIds);

    if (ids.has(city.geonameId)) {
      ids.delete(city.geonameId);
    } else {
      ids.add(city.geonameId);
    }

    setToggled({ key: listKey, ids });
  };

  const setAll = (checked: boolean) => {
    const ids = new Set<number>();

    for (const city of cities) {
      if (isDefaultChecked(city) !== checked) {
        ids.add(city.geonameId);
      }
    }

    setToggled({ key: listKey, ids });
  };

  const tooMany = toAdd.length > props.remaining;

  const add = () => {
    props.onAdd(
      toAdd.map(({ geonameId, name, population }) => ({
        geonameId,
        name,
        population,
      })),
    );
    props.onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <Trans i18nKey={'campaigns.form.nearbyTitle'} />
        </DialogTitle>

        <DialogDescription>
          <Trans i18nKey={'campaigns.form.nearbyDescription'} />
        </DialogDescription>
      </DialogHeader>

      <div className={'flex flex-col gap-4'}>
        <div className={'flex flex-col gap-2'}>
          <Label>
            <Trans i18nKey={'campaigns.form.nearbyCenter'} />
          </Label>

          {center ? (
            <div
              className={
                'bg-muted flex items-center justify-between rounded-md px-3 py-2 text-sm'
              }
            >
              <span className={'flex items-center gap-2 font-medium'}>
                <MapPin className={'size-4'} />
                {center.name}
              </span>

              <button
                type={'button'}
                className={'hover:bg-background rounded-sm p-1'}
                aria-label={t('form.nearbyChangeCenter')}
                onClick={() => setCenter(null)}
              >
                <X className={'size-4'} />
              </button>
            </div>
          ) : (
            <SearchPicker
              data-test={'nearby-center-search'}
              queryKey={['lm-cities', props.countryCode]}
              search={props.searchCities}
              getKey={(item) => String(item.geonameId)}
              renderItem={props.renderCity}
              onSelect={setCenter}
              placeholder={t('form.citySearchPlaceholder')}
            />
          )}
        </div>

        <div className={'grid grid-cols-1 gap-4 sm:grid-cols-3'}>
          <div className={'flex flex-col gap-2 sm:col-span-2'}>
            <Label>
              <Trans i18nKey={'campaigns.form.nearbyRadius'} />
            </Label>

            <div className={'flex flex-wrap items-center gap-1.5'}>
              {RADIUS_PRESETS.map((km) => (
                <Button
                  key={km}
                  type={'button'}
                  size={'sm'}
                  variant={radiusKm === km ? 'default' : 'outline'}
                  data-test={`nearby-radius-${km}`}
                  onClick={() => setRadiusKm(km)}
                >
                  {km} km
                </Button>
              ))}

              <Input
                type={'number'}
                min={1}
                max={100}
                className={'h-8 w-20'}
                aria-label={t('form.nearbyRadius')}
                value={radiusKm}
                onChange={(event) => {
                  const value = Number(event.target.value);

                  if (Number.isFinite(value)) {
                    setRadiusKm(Math.max(1, Math.min(100, value)));
                  }
                }}
              />
            </div>
          </div>

          <div className={'flex flex-col gap-2'}>
            <Label htmlFor={'nearby-min-population'}>
              <Trans i18nKey={'campaigns.form.nearbyMinPopulation'} />
            </Label>

            <Input
              id={'nearby-min-population'}
              type={'number'}
              min={0}
              step={500}
              className={'h-8'}
              value={minPopulation}
              onChange={(event) => {
                const value = Number(event.target.value);

                if (Number.isFinite(value)) {
                  setMinPopulation(Math.max(0, Math.round(value)));
                }
              }}
            />
          </div>
        </div>
      </div>

      {center ? (
        <div className={'flex min-h-0 flex-1 flex-col gap-2'}>
          <div
            className={
              'flex flex-wrap items-center justify-between gap-2 text-sm'
            }
          >
            <span className={'text-muted-foreground flex items-center gap-2'}>
              {isFetching ? <Spinner className={'size-4'} /> : null}

              <Trans
                i18nKey={'campaigns.form.nearbyFound'}
                values={{ count: cities.length, selected: toAdd.length }}
              />
            </span>

            <span className={'flex gap-1'}>
              <Button
                type={'button'}
                size={'sm'}
                variant={'ghost'}
                onClick={() => setAll(true)}
              >
                <Trans i18nKey={'campaigns.form.nearbyCheckAll'} />
              </Button>

              <Button
                type={'button'}
                size={'sm'}
                variant={'ghost'}
                onClick={() => setAll(false)}
              >
                <Trans i18nKey={'campaigns.form.nearbyUncheckAll'} />
              </Button>
            </span>
          </div>

          <ul
            className={
              'min-h-24 flex-1 overflow-y-auto rounded-md border p-1 sm:max-h-80'
            }
            data-test={'nearby-cities-list'}
          >
            {cities.map((city) => {
              const already = props.existingIds.has(city.geonameId);

              return (
                <li key={city.geonameId}>
                  <label
                    className={cn(
                      'hover:bg-muted flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm',
                      already && 'cursor-default opacity-60',
                    )}
                  >
                    <Checkbox
                      checked={isChecked(city)}
                      disabled={already}
                      onCheckedChange={() => toggle(city)}
                    />

                    <span className={'min-w-0 flex-1 truncate'}>
                      {city.name}

                      {already ? (
                        <span className={'text-muted-foreground ml-2 text-xs'}>
                          <Trans i18nKey={'campaigns.form.nearbyAlready'} />
                        </span>
                      ) : city.districtOf ? (
                        <span className={'text-muted-foreground ml-2 text-xs'}>
                          <Trans
                            i18nKey={'campaigns.form.nearbyDistrict'}
                            values={{ city: city.districtOf }}
                          />
                        </span>
                      ) : null}
                    </span>

                    <span
                      className={
                        'text-muted-foreground w-24 text-right text-xs tabular-nums'
                      }
                    >
                      <Trans
                        i18nKey={'campaigns.form.population'}
                        values={{ count: format.number(city.population ?? 0) }}
                      />
                    </span>

                    <span
                      className={
                        'text-muted-foreground w-16 text-right text-xs tabular-nums'
                      }
                    >
                      {format.number(city.distanceKm, {
                        maximumFractionDigits: 1,
                      })}{' '}
                      km
                    </span>
                  </label>
                </li>
              );
            })}

            {!isFetching && cities.length === 0 ? (
              <li className={'text-muted-foreground px-2 py-1.5 text-sm'}>
                <Trans
                  i18nKey={
                    isError
                      ? 'campaigns.errors.searchFailed'
                      : 'campaigns.form.noResults'
                  }
                />
              </li>
            ) : null}
          </ul>

          {tooMany ? (
            <Alert variant={'destructive'}>
              <AlertDescription>
                <Trans
                  i18nKey={'campaigns.form.nearbyTooMany'}
                  values={{ left: props.remaining }}
                />
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type={'button'}
          variant={'outline'}
          onClick={() => props.onOpenChange(false)}
        >
          <Trans i18nKey={'common.cancel'} />
        </Button>

        <Button
          type={'button'}
          data-test={'nearby-cities-add'}
          disabled={!center || toAdd.length === 0 || tooMany}
          onClick={add}
        >
          <Trans
            i18nKey={'campaigns.form.nearbyAdd'}
            values={{ count: toAdd.length }}
          />
        </Button>
      </DialogFooter>
    </>
  );
}
