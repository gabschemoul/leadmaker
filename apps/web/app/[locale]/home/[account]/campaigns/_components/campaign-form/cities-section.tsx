'use client';

/**
 * Rôle : section « Où ? » du formulaire de campagne (pays passé en enfant) (tout le pays, une ville et ses alentours, liste de villes).
 * Données : autocomplétion par searchCitiesAction (lm_geo_cities) ; valeurs dans le formulaire react-hook-form parent.
 * Écritures : aucune en base (modifie seulement les champs du formulaire).
 */

import { useMemo, useState } from 'react';

import { MapPin } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useWatch } from 'react-hook-form';

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
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';

import {
  type CityRef,
  MAX_LIST_CITIES,
} from '../../_lib/schema/campaign.schema';
import { searchCitiesAction } from '../../_lib/server/geo-actions';
import { NearbyCitiesDialog } from '../nearby-cities-dialog';
import { SearchPicker } from '../search-picker';
import {
  ChoiceGroup,
  NumberInput,
  ChipList,
  SelectedChip,
} from './form-controls';

export function CitiesSection(
  props: React.PropsWithChildren<{ countryCode: string }>,
) {
  const t = useTranslations('campaigns');
  const format = useFormatter();
  const mode = useWatch({ name: 'citiesMode' });

  const searchCities = async (query: string) => {
    const result = await searchCitiesAction({
      countryCode: props.countryCode,
      query,
    });

    if (!result?.data) {
      throw new Error(result?.serverError ?? 'search failed');
    }

    return result.data;
  };

  const renderCity = (city: CityRef) => (
    <>
      <span>{city.name}</span>

      <span className={'text-muted-foreground text-xs tabular-nums'}>
        <Trans
          i18nKey={'campaigns.form.population'}
          values={{ count: format.number(city.population ?? 0) }}
        />
      </span>
    </>
  );

  return (
    <Card className={'overflow-visible'}>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey={'campaigns.form.whereTitle'} />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey={'campaigns.form.citiesDescription'} />
        </CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-4'}>
        {/* écran « Qui ? » : le pays, en tête de « Où ? » */}
        {props.children}

        <FormField
          name={'citiesMode'}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <ChoiceGroup
                  data-test={'campaign-cities-mode'}
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'country', label: 'campaigns.form.citiesCountry' },
                    { value: 'radius', label: 'campaigns.form.citiesRadius' },
                    { value: 'list', label: 'campaigns.form.citiesList' },
                  ]}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />

        <If condition={mode === 'country'}>
          <FormField
            name={'minPopulation'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'campaigns.form.minPopulationLabel'} />
                </FormLabel>

                <FormControl>
                  <NumberInput
                    data-test={'campaign-min-population-input'}
                    min={0}
                    step={1000}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>

                <FormDescription>
                  <Trans i18nKey={'campaigns.form.minPopulationHint'} />
                </FormDescription>

                <FormMessage />
              </FormItem>
            )}
          />
        </If>

        <If condition={mode === 'radius'}>
          <div className={'grid grid-cols-1 gap-4 md:grid-cols-3'}>
            <FormField
              name={'radiusCity'}
              render={({ field }) => {
                const city = field.value as CityRef | null;

                return (
                  <FormItem className={'md:col-span-2'}>
                    <FormLabel>
                      <Trans i18nKey={'campaigns.form.radiusCityLabel'} />
                    </FormLabel>

                    <FormControl>
                      {city ? (
                        <SelectedChip
                          data-test={'campaign-radius-city'}
                          label={city.name}
                          onRemove={() => field.onChange(null)}
                        />
                      ) : (
                        <SearchPicker
                          data-test={'campaign-radius-city-search'}
                          queryKey={['lm-cities', props.countryCode]}
                          search={searchCities}
                          getKey={(item) => String(item.geonameId)}
                          renderItem={renderCity}
                          onSelect={(item) => field.onChange(item)}
                          placeholder={t('form.citySearchPlaceholder')}
                        />
                      )}
                    </FormControl>

                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <FormField
              name={'radiusKm'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey={'campaigns.form.radiusKmLabel'} />
                  </FormLabel>

                  <FormControl>
                    <NumberInput
                      data-test={'campaign-radius-km-input'}
                      min={1}
                      max={500}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </If>

        <If condition={mode === 'list'}>
          <FormField
            name={'cities'}
            render={({ field }) => (
              <CitiesListField
                cities={(field.value ?? []) as CityRef[]}
                onChange={field.onChange}
                countryCode={props.countryCode}
                searchCities={searchCities}
                renderCity={renderCity}
              />
            )}
          />
        </If>
      </CardContent>
    </Card>
  );
}

/** Nombre de villes affichées avant « Tout afficher ». */
const CITIES_PREVIEW = 40;

function CitiesListField(props: {
  cities: CityRef[];
  onChange: (cities: CityRef[]) => void;
  countryCode: string;
  searchCities: (query: string) => Promise<CityRef[]>;
  renderCity: (city: CityRef) => React.ReactNode;
}) {
  const t = useTranslations('campaigns');
  const { cities, onChange } = props;

  const [nearby, setNearby] = useState<{
    open: boolean;
    center: CityRef | null;
  }>({ open: false, center: null });
  const [showAll, setShowAll] = useState(false);

  const existingIds = useMemo(
    () => new Set(cities.map((city) => city.geonameId)),
    [cities],
  );

  const addCities = (added: CityRef[]) => {
    const fresh = added.filter((city) => !existingIds.has(city.geonameId));

    onChange([...cities, ...fresh].slice(0, MAX_LIST_CITIES));
  };

  const visible = showAll ? cities : cities.slice(0, CITIES_PREVIEW);

  return (
    <FormItem>
      <div className={'flex flex-wrap items-center justify-between gap-2'}>
        <FormLabel>
          <Trans i18nKey={'campaigns.form.citiesListLabel'} />
        </FormLabel>

        <Button
          type={'button'}
          size={'sm'}
          variant={'outline'}
          data-test={'campaign-nearby-open'}
          onClick={() => setNearby({ open: true, center: null })}
        >
          <MapPin className={'mr-1.5 size-4'} />
          <Trans i18nKey={'campaigns.form.nearbyOpen'} />
        </Button>
      </div>

      <FormControl>
        <SearchPicker
          data-test={'campaign-cities-search'}
          queryKey={['lm-cities', props.countryCode]}
          search={props.searchCities}
          getKey={(item) => String(item.geonameId)}
          renderItem={props.renderCity}
          isSelected={(item) => existingIds.has(item.geonameId)}
          onSelect={(item) => addCities([item])}
          secondaryAction={{
            label: t('form.nearbyButton'),
            'data-test': 'campaign-city-nearby',
            onSelect: (item) => setNearby({ open: true, center: item }),
          }}
          placeholder={t('form.citySearchPlaceholder')}
        />
      </FormControl>

      <FormDescription>
        <Trans i18nKey={'campaigns.form.nearbyHint'} />
      </FormDescription>

      <If condition={cities.length > 0}>
        <div className={'flex items-center justify-between gap-2 text-sm'}>
          <span className={'text-muted-foreground'}>
            <Trans
              i18nKey={'campaigns.form.citiesCount'}
              values={{ count: cities.length }}
            />
          </span>

          <Button
            type={'button'}
            size={'sm'}
            variant={'ghost'}
            data-test={'campaign-cities-clear'}
            onClick={() => onChange([])}
          >
            <Trans i18nKey={'campaigns.form.citiesClear'} />
          </Button>
        </div>
      </If>

      <ChipList>
        {visible.map((city) => (
          <SelectedChip
            key={city.geonameId}
            label={city.name}
            onRemove={() =>
              onChange(cities.filter((c) => c.geonameId !== city.geonameId))
            }
          />
        ))}

        {cities.length > CITIES_PREVIEW ? (
          <Button
            type={'button'}
            size={'sm'}
            variant={'link'}
            className={'h-7'}
            onClick={() => setShowAll((value) => !value)}
          >
            <Trans
              i18nKey={
                showAll
                  ? 'campaigns.form.citiesShowLess'
                  : 'campaigns.form.citiesShowAll'
              }
              values={{ count: cities.length - CITIES_PREVIEW }}
            />
          </Button>
        ) : null}
      </ChipList>

      <FormMessage />

      <NearbyCitiesDialog
        open={nearby.open}
        onOpenChange={(open) => setNearby((prev) => ({ ...prev, open }))}
        countryCode={props.countryCode}
        initialCenter={nearby.center}
        existingIds={existingIds}
        remaining={MAX_LIST_CITIES - cities.length}
        searchCities={props.searchCities}
        renderCity={props.renderCity}
        onAdd={addCities}
      />
    </FormItem>
  );
}
