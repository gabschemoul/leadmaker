'use client';

import { useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

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
import { Spinner } from '@kit/ui/spinner';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import type { CategoryRef } from '../_lib/schema/campaign.schema';
import {
  listCategoryFamiliesAction,
  listFamilyCategoriesAction,
} from '../_lib/server/server-actions';

/**
 * Catalogue des activités Google, rangé par famille (Restauration &
 * alimentation, BTP & artisans, Santé…). Chaque famille se déplie ; on coche
 * les activités une à une ou toute la famille. Les coches s'appliquent tout
 * de suite à la campagne.
 */
export function CategoryBrowserDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: CategoryRef[];
  onChange: (categories: CategoryRef[]) => void;
  max: number;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className={'flex max-h-[90vh] flex-col sm:max-w-2xl'}
        data-test={'category-browser-dialog'}
      >
        {props.open ? <CategoryBrowserBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CategoryBrowserBody(
  props: Parameters<typeof CategoryBrowserDialog>[0],
) {
  const t = useTranslations('campaigns.form');
  const [openFamily, setOpenFamily] = useState<string | null>(null);

  const families = useQuery({
    queryKey: ['lm-category-families'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const result = await listCategoryFamiliesAction();

      if (!result?.data) {
        throw new Error(result?.serverError ?? 'families failed');
      }

      return result.data;
    },
  });

  const selectedIds = useMemo(
    () => new Set(props.selected.map((category) => category.gcid)),
    [props.selected],
  );

  const countByFamily = useMemo(() => {
    const counts = new Map<string, number>();

    for (const category of props.selected) {
      if (category.family) {
        counts.set(category.family, (counts.get(category.family) ?? 0) + 1);
      }
    }

    return counts;
  }, [props.selected]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <Trans i18nKey={'campaigns.form.browseTitle'} />
        </DialogTitle>

        <DialogDescription>
          <Trans i18nKey={'campaigns.form.browseDescription'} />
        </DialogDescription>
      </DialogHeader>

      <div
        className={'min-h-40 flex-1 overflow-y-auto rounded-md border'}
        data-test={'category-families'}
      >
        {families.isPending ? (
          <div className={'flex justify-center p-6'}>
            <Spinner className={'size-5'} />
          </div>
        ) : families.isError ? (
          <p className={'text-muted-foreground p-4 text-sm'}>
            <Trans i18nKey={'campaigns.errors.searchFailed'} />
          </p>
        ) : (
          families.data.map((item) => (
            <FamilyRow
              key={item.family}
              family={item.family}
              total={item.count}
              selectedCount={countByFamily.get(item.family) ?? 0}
              open={openFamily === item.family}
              onToggleOpen={() =>
                setOpenFamily((current) =>
                  current === item.family ? null : item.family,
                )
              }
              selectedIds={selectedIds}
              selected={props.selected}
              onChange={props.onChange}
              max={props.max}
            />
          ))
        )}
      </div>

      <DialogFooter className={'items-center sm:justify-between'}>
        <span className={'text-muted-foreground text-sm'}>
          {t('browseSelected', { count: props.selected.length })}
        </span>

        <Button
          type={'button'}
          data-test={'category-browser-done'}
          onClick={() => props.onOpenChange(false)}
        >
          <Trans i18nKey={'campaigns.form.browseDone'} />
        </Button>
      </DialogFooter>
    </>
  );
}

function FamilyRow(props: {
  family: string;
  total: number;
  selectedCount: number;
  open: boolean;
  onToggleOpen: () => void;
  selectedIds: ReadonlySet<string>;
  selected: CategoryRef[];
  onChange: (categories: CategoryRef[]) => void;
  max: number;
}) {
  const t = useTranslations('campaigns.form');
  const locale = useLocale();

  const categories = useQuery({
    queryKey: ['lm-family-categories', props.family, locale],
    enabled: props.open,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const result = await listFamilyCategoriesAction({ family: props.family });

      if (!result?.data) {
        throw new Error(result?.serverError ?? 'family failed');
      }

      return result.data.map((category) => ({
        gcid: category.gcid,
        label: locale.startsWith('fr') ? category.labelFr : category.labelEn,
        family: category.family,
        common: category.common,
      }));
    },
  });

  const items = categories.data ?? [];
  const allChecked =
    items.length > 0 && items.every((item) => props.selectedIds.has(item.gcid));

  const toggle = (item: CategoryRef) => {
    if (props.selectedIds.has(item.gcid)) {
      props.onChange(props.selected.filter((c) => c.gcid !== item.gcid));
    } else if (props.selected.length < props.max) {
      props.onChange([
        ...props.selected,
        { gcid: item.gcid, label: item.label, family: item.family },
      ]);
    }
  };

  const toggleAll = () => {
    if (allChecked) {
      const ids = new Set(items.map((item) => item.gcid));
      props.onChange(props.selected.filter((c) => !ids.has(c.gcid)));
    } else {
      const fresh = items
        .filter((item) => !props.selectedIds.has(item.gcid))
        .map(({ gcid, label, family }) => ({ gcid, label, family }));

      props.onChange([...props.selected, ...fresh].slice(0, props.max));
    }
  };

  return (
    <div className={'border-b last:border-b-0'}>
      <button
        type={'button'}
        onClick={props.onToggleOpen}
        aria-expanded={props.open}
        data-test={'category-family'}
        className={
          'hover:bg-muted flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm'
        }
      >
        {props.open ? (
          <ChevronDown className={'size-4 shrink-0'} />
        ) : (
          <ChevronRight className={'size-4 shrink-0'} />
        )}

        <span className={'flex-1 font-medium'}>{props.family}</span>

        {props.selectedCount > 0 ? (
          <span
            className={
              'bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums'
            }
          >
            {props.selectedCount}
          </span>
        ) : null}

        <span className={'text-muted-foreground text-xs tabular-nums'}>
          {t('browseFamilyCount', { count: props.total })}
        </span>
      </button>

      {props.open ? (
        <div className={'bg-muted/30 px-3 pb-3'}>
          {categories.isPending ? (
            <div className={'flex justify-center p-4'}>
              <Spinner className={'size-4'} />
            </div>
          ) : (
            <>
              <label
                className={
                  'flex cursor-pointer items-center gap-3 border-b py-2 text-sm font-medium'
                }
              >
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={toggleAll}
                  data-test={'category-family-all'}
                />
                <span>{t('browseAll', { family: props.family })}</span>
              </label>

              <ul className={'grid grid-cols-1 gap-x-4 sm:grid-cols-2'}>
                {items.map((item) => (
                  <li key={item.gcid}>
                    <label
                      className={cn(
                        'hover:bg-muted flex cursor-pointer items-center gap-3 rounded-sm px-1 py-1.5 text-sm',
                        item.common && 'font-medium',
                      )}
                    >
                      <Checkbox
                        checked={props.selectedIds.has(item.gcid)}
                        onCheckedChange={() => toggle(item)}
                      />
                      <span className={'min-w-0 truncate'}>{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
