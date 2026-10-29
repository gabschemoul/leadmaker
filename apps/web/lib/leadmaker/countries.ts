/**
 * Noms de pays dans la langue de l'interface (la table lm_country_coverage
 * les stocke en anglais). France et États-Unis en tête de liste.
 */

export interface CountryOption {
  code: string;
  label: string;
}

const PINNED = ['FR', 'US'];

export function countryLabel(code: string, locale: string, fallback?: string) {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region' });

    return names.of(code) ?? fallback ?? code;
  } catch {
    return fallback ?? code;
  }
}

export function toCountryOptions(
  countries: Array<{ country_code: string; name: string }>,
  locale: string,
): CountryOption[] {
  const options = countries.map((country) => ({
    code: country.country_code,
    label: countryLabel(country.country_code, locale, country.name),
  }));

  const pinned = PINNED.map((code) =>
    options.find((option) => option.code === code),
  ).filter((option): option is CountryOption => Boolean(option));

  const others = options
    .filter((option) => !PINNED.includes(option.code))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  return [...pinned, ...others];
}
