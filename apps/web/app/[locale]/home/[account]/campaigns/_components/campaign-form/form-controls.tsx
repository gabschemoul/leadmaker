'use client';

/**
 * Rôle : petits contrôles partagés par les sections du formulaire de campagne (choix, nombre, étiquettes).
 * Données : props uniquement.
 * Écritures : aucune.
 */

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@kit/ui/badge';
import { Input } from '@kit/ui/input';
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemLabel,
} from '@kit/ui/radio-group';
import { Trans } from '@kit/ui/trans';

export function ChoiceGroup(props: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; description?: string }>;
  'data-test'?: string;
}) {
  return (
    <RadioGroup
      data-test={props['data-test']}
      value={props.value}
      onValueChange={(value) => props.onChange(String(value))}
    >
      {props.options.map((option) => (
        <RadioGroupItemLabel
          key={option.value}
          selected={props.value === option.value}
          data-test={`${props['data-test']}-${option.value}`}
          onClick={() => props.onChange(option.value)}
        >
          <RadioGroupItem value={option.value} />

          <span className={'flex flex-col'}>
            <span>
              <Trans i18nKey={option.label} />
            </span>

            {option.description ? (
              <span className={'text-muted-foreground text-xs'}>
                <Trans i18nKey={option.description} />
              </span>
            ) : null}
          </span>
        </RadioGroupItemLabel>
      ))}
    </RadioGroup>
  );
}

export function NumberInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      type={'number'}
      inputMode={'decimal'}
      value={Number.isFinite(value) ? value : ''}
      onChange={(event) => onChange(event.target.valueAsNumber)}
      {...props}
    />
  );
}

export function ChipList(props: React.PropsWithChildren) {
  return <div className={'flex flex-wrap gap-2'}>{props.children}</div>;
}

export function SelectedChip(props: {
  label: string;
  detail?: string;
  onRemove: () => void;
  'data-test'?: string;
}) {
  const t = useTranslations('campaigns');

  return (
    <Badge
      variant={'secondary'}
      className={'h-7 gap-1.5 pr-1 pl-2.5 text-sm'}
      data-test={props['data-test'] ?? 'selected-chip'}
    >
      <span>{props.label}</span>

      {props.detail ? (
        <span className={'text-muted-foreground text-xs'}>{props.detail}</span>
      ) : null}

      <button
        type={'button'}
        className={'hover:bg-muted rounded-sm p-0.5'}
        aria-label={t('form.remove')}
        onClick={props.onRemove}
      >
        <X className={'size-3.5'} />
      </button>
    </Badge>
  );
}
