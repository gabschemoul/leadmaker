import { parseCsv } from './csv';
import { siteKey } from './site-key';

/**
 * Transforme un fichier CSV en lignes prêtes pour `lm_import_prospects`.
 * Les colonnes sont reconnues par leur en-tête, sans tenir compte de la
 * casse, des accents ni des tirets.
 */

export interface ImportRow {
  name: string;
  website: string;
  site_key: string;
  phone: string | null;
  email: string | null;
  category: string | null;
  address: string | null;
  country_code: string | null;
  maps_url: string | null;
}

type Field = Exclude<keyof ImportRow, 'site_key'>;

const MAPS_PLACE_ID = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i;

/**
 * Clé de dédoublonnage d'une ligne : le site web, à défaut la fiche Google Maps
 * (même clé que le scan : « maps:<identifiant> »), à défaut le téléphone.
 */
export function prospectKey(website: string, mapsUrl: string, phone: string) {
  const fromSite = siteKey(website);

  if (fromSite) {
    return fromSite;
  }

  const placeId = MAPS_PLACE_ID.exec(mapsUrl)?.[1];

  if (placeId) {
    return `maps:${placeId.toLowerCase()}`;
  }

  const digits = phone.replace(/\D/g, '');

  return digits.length >= 8 ? `tel:${digits}` : null;
}

const HEADER_ALIASES: Record<Field, string[]> = {
  name: [
    'nom',
    'name',
    'entreprise',
    'company',
    'raison sociale',
    'societe',
    'company name',
    'nom entreprise',
  ],
  website: [
    'site',
    'site web',
    'website',
    'url',
    'domaine',
    'domain',
    'site internet',
    'web',
  ],
  phone: ['telephone', 'phone', 'tel', 'phone number'],
  email: ['email', 'e mail', 'mail', 'courriel'],
  category: ['categorie', 'category', 'activite'],
  address: ['adresse', 'address'],
  maps_url: [
    'maps url',
    'lien google maps',
    'google maps',
    'lien maps',
    'maps',
    'fiche google',
  ],
  country_code: ['pays', 'country', 'country code', 'code pays'],
};

export function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_.']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapColumns(header: string[]) {
  const normalized = header.map(normalizeHeader);
  const columns: Partial<Record<Field, number>> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [Field, string[]]
  >) {
    const index = normalized.findIndex((value) => aliases.includes(value));

    if (index >= 0) {
      columns[field] = index;
    }
  }

  return columns;
}

/** Longueurs maximales des colonnes de lm_prospects. */
export const IMPORT_LIMITS = {
  name: 500,
  website: 1000,
  site_key: 2000,
  phone: 50,
  email: 320,
  category: 255,
  address: 1000,
  maps_url: 1000,
} as const;

function optional(value: string | undefined, maxLength: number) {
  const trimmed = value?.trim();

  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export type ImportParseResult =
  | { ok: false; error: 'empty' | 'missingColumns' }
  | { ok: true; rows: ImportRow[]; total: number; skipped: number };

export function parseProspectsCsv(text: string): ImportParseResult {
  const { rows: table } = parseCsv(text);
  const [header, ...lines] = table;

  if (!header || lines.length === 0) {
    return { ok: false, error: 'empty' };
  }

  const columns = mapColumns(header);

  if (
    columns.name === undefined ||
    (columns.website === undefined &&
      columns.maps_url === undefined &&
      columns.phone === undefined)
  ) {
    return { ok: false, error: 'missingColumns' };
  }

  const cell = (line: string[], field: Field) => {
    const index = columns[field];

    return index === undefined ? undefined : line[index];
  };

  const rows: ImportRow[] = [];

  for (const line of lines) {
    const name = cell(line, 'name')?.trim() ?? '';
    const website = cell(line, 'website')?.trim() ?? '';
    const mapsUrl = cell(line, 'maps_url')?.trim() ?? '';
    const key = prospectKey(website, mapsUrl, cell(line, 'phone') ?? '');

    if (!name || !key) {
      continue;
    }

    const country = cell(line, 'country_code')?.trim() ?? '';

    if (key.length > IMPORT_LIMITS.site_key) {
      continue;
    }

    rows.push({
      name: name.slice(0, IMPORT_LIMITS.name),
      website: website.slice(0, IMPORT_LIMITS.website),
      site_key: key,
      phone: optional(cell(line, 'phone'), IMPORT_LIMITS.phone),
      email:
        optional(cell(line, 'email'), IMPORT_LIMITS.email)?.toLowerCase() ??
        null,
      category: optional(cell(line, 'category'), IMPORT_LIMITS.category),
      address: optional(cell(line, 'address'), IMPORT_LIMITS.address),
      maps_url: optional(mapsUrl, IMPORT_LIMITS.maps_url),
      // seul un code pays sur deux lettres est accepté ; sinon le pays de l'espace s'applique
      country_code: /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null,
    });
  }

  return {
    ok: true,
    rows,
    total: lines.length,
    skipped: lines.length - rows.length,
  };
}

/**
 * Découpe en paquets de `maxRows` lignes, en restant sous `maxBytes` de JSON
 * pour ne pas dépasser la taille maximale d'une server action (1 Mo).
 */
export function chunkRows(
  rows: ImportRow[],
  maxRows = 2000,
  maxBytes = 700_000,
) {
  const chunks: ImportRow[][] = [];
  let current: ImportRow[] = [];
  let size = 0;

  for (const row of rows) {
    const rowSize = JSON.stringify(row).length + 1;

    if (
      current.length > 0 &&
      (current.length >= maxRows || size + rowSize > maxBytes)
    ) {
      chunks.push(current);
      current = [];
      size = 0;
    }

    current.push(row);
    size += rowSize;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
