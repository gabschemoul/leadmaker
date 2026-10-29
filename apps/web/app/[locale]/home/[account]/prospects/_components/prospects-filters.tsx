'use client';

import Form from 'next/form';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';
import { Trans } from '@kit/ui/trans';

/**
 * Filtres de la liste : un formulaire GET qui réécrit les paramètres d'URL
 * (navigation côté client via next/form). Changer de liste déroulante
 * relance la recherche immédiatement.
 */
export function ProspectsFilters(props: {
  action: string;
  spaces: Array<{ id: string; name: string }>;
  spaceId: string;
  query: string;
  source: string;
}) {
  const t = useTranslations('campaigns');

  const submitOnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <Form
      // remonte le formulaire quand l'URL change, pour resynchroniser les champs
      key={`${props.spaceId}|${props.query}|${props.source}`}
      action={props.action}
      data-test={'prospects-filters'}
      className={'flex flex-col gap-2 md:flex-row md:items-center'}
    >
      <NativeSelect
        name={'space'}
        aria-label={t('prospects.spaceFilter')}
        data-test={'prospects-space-select'}
        defaultValue={props.spaceId}
        onChange={submitOnChange}
      >
        {props.spaces.map((space) => (
          <NativeSelectOption key={space.id} value={space.id}>
            {space.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      <NativeSelect
        name={'source'}
        aria-label={t('prospects.sourceFilter')}
        data-test={'prospects-source-select'}
        defaultValue={props.source}
        onChange={submitOnChange}
      >
        <NativeSelectOption value={''}>
          {t('prospects.sourceAll')}
        </NativeSelectOption>

        <NativeSelectOption value={'maps'}>
          {t('prospects.source.maps')}
        </NativeSelectOption>

        <NativeSelectOption value={'csv'}>
          {t('prospects.source.csv')}
        </NativeSelectOption>
      </NativeSelect>

      <div className={'flex gap-2'}>
        <Input
          name={'q'}
          type={'search'}
          className={'md:w-64'}
          data-test={'prospects-search-input'}
          defaultValue={props.query}
          placeholder={t('prospects.searchPlaceholder')}
          maxLength={100}
        />

        <Button
          type={'submit'}
          variant={'secondary'}
          data-test={'prospects-search-button'}
        >
          <Search className={'w-4'} />

          <span>
            <Trans i18nKey={'campaigns.prospects.searchButton'} />
          </span>
        </Button>
      </div>
    </Form>
  );
}
