'use client';

import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';

import type { CountryOption } from '~/lib/leadmaker/countries';

export function CountrySelect({
  countries,
  value,
  onChange,
  ...props
}: {
  countries: CountryOption[];
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  'data-test'?: string;
}) {
  return (
    <NativeSelect
      className={'w-full'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...props}
    >
      {countries.map((country) => (
        <NativeSelectOption key={country.code} value={country.code}>
          {country.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
