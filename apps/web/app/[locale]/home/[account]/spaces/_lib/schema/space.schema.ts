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
