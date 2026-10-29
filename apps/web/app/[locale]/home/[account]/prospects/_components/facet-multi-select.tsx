'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useFormatter } from 'next-intl';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@kit/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { cn } from '@kit/ui/utils';

/**
 * Filtre à choix multiples alimenté par une facette (valeur + nombre de
 * prospects). Chaque clic applique le filtre aussitôt.
 */
export function FacetMultiSelect(props: {
  label: string;
  options: Array<{ value: string; total: number }>;
  selected: string[];
  onChange: (values: string[]) => void;
  searchPlaceholder: string;
  emptyLabel: string;
  'data-test': string;
}) {
  const format = useFormatter();
  const selected = new Set(props.selected);

  const toggle = (value: string) => {
    const next = new Set(selected);

    if (next.has(value)) next.delete(value);
    else next.add(value);

    props.onChange(Array.from(next));
  };

  // une valeur filtrée qui n'existe plus dans l'espace reste visible pour
  // pouvoir la retirer
  const options = [
    ...props.options,
    ...props.selected
      .filter((value) => !props.options.some((o) => o.value === value))
      .map((value) => ({ value, total: 0 })),
  ];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size={'sm'}
            variant={'outline'}
            data-test={props['data-test']}
            disabled={options.length === 0}
          />
        }
      >
        <span>{props.label}</span>

        {selected.size > 0 ? (
          <Badge variant={'secondary'} className={'px-1.5'}>
            {selected.size}
          </Badge>
        ) : null}

        <ChevronDown className={'text-muted-foreground w-4'} />
      </PopoverTrigger>

      <PopoverContent align={'start'} className={'w-72 p-0'}>
        <Command>
          <CommandInput placeholder={props.searchPlaceholder} />

          <CommandList className={'max-h-64'}>
            <CommandEmpty>{props.emptyLabel}</CommandEmpty>

            <CommandGroup>
              {options.map((option) => {
                const active = selected.has(option.value);

                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    data-test={`${props['data-test']}-option`}
                    data-selected={active ? 'true' : undefined}
                    onSelect={() => toggle(option.value)}
                  >
                    <span
                      className={cn(
                        'border-input flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                        active &&
                          'bg-primary text-primary-foreground border-primary',
                      )}
                    >
                      {active ? <Check className={'size-3'} /> : null}
                    </span>

                    <span className={'flex-1 truncate'}>{option.value}</span>

                    <span className={'text-muted-foreground tabular-nums'}>
                      {format.number(option.total)}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
