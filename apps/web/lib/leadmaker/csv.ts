/**
 * Lecture et écriture CSV sans dépendance.
 *
 * Lecture : BOM UTF-8 retiré, séparateur « ; » ou « , » détecté sur la ligne
 * d'en-tête, champs entre guillemets (avec « "" » pour un guillemet et des
 * retours à la ligne autorisés à l'intérieur).
 */

export type CsvDelimiter = ',' | ';';

export function detectDelimiter(text: string): CsvDelimiter {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;

  for (const char of text) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === '\n' || char === '\r') {
        break;
      }

      if (char === ',') commas++;
      if (char === ';') semicolons++;
    }
  }

  return semicolons > commas ? ';' : ',';
}

export function parseCsv(input: string) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const pushRow = () => {
    row.push(field);
    field = '';

    if (row.some((value) => value.trim() !== '')) {
      rows.push(row);
    }

    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
      } else {
        field += char;
      }

      index++;
      continue;
    }

    if (char === '"' && field.trim() === '') {
      // un guillemet ouvrant n'a de sens qu'en début de champ
      field = '';
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      pushRow();

      if (text[index + 1] === '\n') {
        index++;
      }
    } else if (char === '\n') {
      pushRow();
    } else {
      field += char;
    }

    index++;
  }

  if (field !== '' || row.length > 0) {
    pushRow();
  }

  return { rows, delimiter };
}

/** Échappe une valeur pour un CSV séparé par des virgules. */
export function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);

  if (/[",;\r\n]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function toCsvLine(values: unknown[], separator: ',' | ';' = ',') {
  return values.map(escapeCsvValue).join(separator) + '\r\n';
}

/**
 * Excel en français, allemand, espagnol… attend le point-virgule comme
 * séparateur ; en anglais, la virgule. On suit la langue du navigateur.
 */
export function csvSeparatorFor(acceptLanguage: string | null) {
  return /^(fr|de|es|it|pt|nl|pl|ru|cs|da|fi|sv|nb|no|tr)\b/i.test(
    (acceptLanguage ?? '').trim(),
  )
    ? ';'
    : ',';
}
