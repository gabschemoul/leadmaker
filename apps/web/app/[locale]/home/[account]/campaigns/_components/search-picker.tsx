'use client';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import { Input } from '@kit/ui/input';
import { Spinner } from '@kit/ui/spinner';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { useDebouncedValue } from '../_lib/use-debounced-value';

/**
 * Champ de recherche avec liste de suggestions chargées depuis le serveur.
 * Choisir une suggestion appelle `onSelect` et vide le champ.
 */
export function SearchPicker<Item>(props: {
  queryKey: readonly unknown[];
  search: (query: string) => Promise<Item[]>;
  getKey: (item: Item) => string;
  renderItem: (item: Item) => React.ReactNode;
  onSelect: (item: Item) => void;
  isSelected?: (item: Item) => boolean;
  placeholder?: string;
  minLength?: number;
  'data-test'?: string;
}) {
  const [state, setState] = useState({ input: '', open: false, active: 0 });
  const minLength = props.minLength ?? 1;
  const term = useDebouncedValue(state.input.trim(), 250);
  const enabled = term.length >= minLength;

  const { data, isFetching, isError } = useQuery({
    queryKey: [...props.queryKey, term],
    queryFn: () => props.search(term),
    enabled,
    staleTime: 60_000,
  });

  const items = enabled ? (data ?? []) : [];
  const showList = state.open && enabled;

  const select = (item: Item) => {
    props.onSelect(item);
    setState({ input: '', open: false, active: 0 });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setState((prev) => ({
        ...prev,
        open: true,
        active: Math.min(prev.active + 1, Math.max(items.length - 1, 0)),
      }));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setState((prev) => ({ ...prev, active: Math.max(prev.active - 1, 0) }));
    } else if (event.key === 'Enter') {
      // ne jamais soumettre le formulaire depuis ce champ
      event.preventDefault();

      const item = items[state.active];

      if (showList && item) {
        select(item);
      }
    } else if (event.key === 'Escape') {
      setState((prev) => ({ ...prev, open: false }));
    }
  };

  return (
    <div className={'relative'}>
      <div className={'relative'}>
        <Search
          className={
            'text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
          }
        />

        <Input
          data-test={props['data-test']}
          className={'pl-8'}
          value={state.input}
          placeholder={props.placeholder}
          autoComplete={'off'}
          role={'combobox'}
          aria-expanded={showList}
          onChange={(event) =>
            setState({ input: event.target.value, open: true, active: 0 })
          }
          onFocus={() => setState((prev) => ({ ...prev, open: true }))}
          onBlur={() => setState((prev) => ({ ...prev, open: false }))}
          onKeyDown={onKeyDown}
        />

        {isFetching ? (
          <Spinner
            className={'absolute top-1/2 right-2.5 size-4 -translate-y-1/2'}
          />
        ) : null}
      </div>

      {showList ? (
        <ul
          role={'listbox'}
          className={
            'bg-popover text-popover-foreground absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border p-1 shadow-md'
          }
        >
          {items.map((item, index) => {
            const selected = props.isSelected?.(item) ?? false;

            return (
              <li
                key={props.getKey(item)}
                role={'option'}
                aria-selected={index === state.active}
                data-test={'search-picker-option'}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm',
                  index === state.active && 'bg-muted',
                  selected && 'text-muted-foreground',
                )}
                // mousedown plutôt que click : le champ perdrait le focus
                // (et fermerait la liste) avant que le clic n'arrive
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(item);
                }}
                onMouseEnter={() =>
                  setState((prev) => ({ ...prev, active: index }))
                }
              >
                {props.renderItem(item)}
              </li>
            );
          })}

          {!isFetching && items.length === 0 ? (
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
      ) : null}
    </div>
  );
}
