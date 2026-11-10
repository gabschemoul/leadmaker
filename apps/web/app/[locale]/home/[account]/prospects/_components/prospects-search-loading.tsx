'use client';

import { useTranslations } from 'next-intl';

import { Input } from '@kit/ui/input';

/** Champ de recherche de la page Prospects, inactif pendant le premier chargement (texte d'aide réel). */
export function ProspectsSearchLoading() {
  const t = useTranslations('prospects');

  return (
    <Input
      disabled
      type={'search'}
      className={'h-8 w-56 pl-9 text-[14px] md:w-72'}
      placeholder={t('filters.searchPlaceholder')}
    />
  );
}
