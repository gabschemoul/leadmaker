import * as z from 'zod';

export const ATTEMPTS_BATCH_LIMIT = 500;

export const AttemptIdsSchema = z.object({
  accountId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1).max(ATTEMPTS_BATCH_LIMIT),
});

/** Modification d'un formulaire avant validation : objet, message, champs manquants. */
export const AttemptEditFormSchema = z.object({
  subject: z.string().trim().max(200, { message: 'outreach.messages.tooLong' }),
  body: z.string().max(5000, { message: 'outreach.messages.tooLong' }),
  extraValues: z.array(
    z.object({
      label: z.string().max(200),
      value: z
        .string()
        .trim()
        .max(500, { message: 'outreach.messages.tooLong' }),
    }),
  ),
});

export type AttemptEditFormValues = z.infer<typeof AttemptEditFormSchema>;

export const UpdateAttemptSchema = AttemptEditFormSchema.extend({
  accountId: z.string().uuid(),
  id: z.string().uuid(),
  /** valider dans la foulée */
  validate: z.boolean(),
});
