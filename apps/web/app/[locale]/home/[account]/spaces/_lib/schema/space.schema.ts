import * as z from 'zod';

export const SpaceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'campaigns.folders.nameRequired' })
    .max(100, { message: 'campaigns.folders.nameTooLong' }),
});

export const CreateSpaceSchema = SpaceFormSchema.extend({
  accountId: z.string().uuid(),
});

/** Renommer un dossier client. */
export const RenameSpaceSchema = SpaceFormSchema.extend({
  accountId: z.string().uuid(),
  spaceId: z.string().uuid(),
});

/** Supprimer un dossier client (jamais celui par défaut ; tout son contenu part avec). */
export const DeleteSpaceSchema = z.object({
  accountId: z.string().uuid(),
  spaceId: z.string().uuid(),
});
