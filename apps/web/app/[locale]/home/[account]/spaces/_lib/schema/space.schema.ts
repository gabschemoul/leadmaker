import * as z from 'zod';

export const SpaceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'campaigns.spaces.nameRequired' })
    .max(100, { message: 'campaigns.spaces.nameTooLong' }),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, { message: 'campaigns.spaces.countryRequired' }),
});

export const CreateSpaceSchema = SpaceFormSchema.extend({
  accountId: z.string().uuid(),
});
