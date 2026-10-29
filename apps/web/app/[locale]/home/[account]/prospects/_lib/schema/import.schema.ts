import * as z from 'zod';

import { IMPORT_LIMITS } from '~/lib/leadmaker/import-prospects';

const optionalText = (max: number) => z.string().max(max).nullable();

export const ImportRowSchema = z.object({
  name: z.string().min(1).max(IMPORT_LIMITS.name),
  website: z.string().max(IMPORT_LIMITS.website),
  site_key: z.string().min(1).max(IMPORT_LIMITS.site_key),
  phone: optionalText(IMPORT_LIMITS.phone),
  email: optionalText(IMPORT_LIMITS.email),
  category: optionalText(IMPORT_LIMITS.category),
  address: optionalText(IMPORT_LIMITS.address),
  country_code: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
});

export const ImportProspectsSchema = z.object({
  spaceId: z.string().uuid(),
  rows: z.array(ImportRowSchema).min(1).max(2000),
});

export const ImportFormSchema = z.object({
  spaceId: z.string().min(1, { error: 'campaigns.import.spaceRequired' }),
  file: z.instanceof(File, { error: 'campaigns.import.fileRequired' }),
});
