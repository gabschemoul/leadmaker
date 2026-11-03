import * as z from 'zod';

const TOO_LONG = 'outreach.sender.tooLong';

const optionalText = (max: number) =>
  z.string().trim().max(max, { message: TOO_LONG });

export const CIVILITIES = ['', 'mrs', 'mr'] as const;

export type Civility = (typeof CIVILITIES)[number];

/**
 * Profil expéditeur : l'identité écrite dans les formulaires de contact.
 * Les champs vides sont enregistrés comme « non renseigné » (null).
 */
export const SenderProfileFormSchema = z.object({
  civility: z.enum(CIVILITIES),
  firstName: z
    .string()
    .trim()
    .min(1, { message: 'outreach.sender.firstNameRequired' })
    .max(100, { message: TOO_LONG }),
  lastName: z
    .string()
    .trim()
    .min(1, { message: 'outreach.sender.lastNameRequired' })
    .max(100, { message: TOO_LONG }),
  jobTitle: optionalText(150),
  company: z
    .string()
    .trim()
    .min(1, { message: 'outreach.sender.companyRequired' })
    .max(255, { message: TOO_LONG }),
  email: z
    .string()
    .trim()
    .email({ message: 'outreach.sender.emailInvalid' })
    .max(320, { message: TOO_LONG }),
  phone: optionalText(50),
  website: optionalText(500).refine(
    (value) => value === '' || /^(https?:\/\/)?[^\s/$.?#].[^\s]*$/i.test(value),
    { message: 'outreach.sender.websiteInvalid' },
  ),
  address: optionalText(500),
  zip: optionalText(20),
  city: optionalText(150),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, { message: 'outreach.sender.countryRequired' }),
});

export type SenderProfileFormValues = z.infer<typeof SenderProfileFormSchema>;

export const SaveSenderProfileSchema = SenderProfileFormSchema.extend({
  accountId: z.string().uuid(),
  accountSlug: z.string().min(1),
  spaceId: z.string().uuid(),
  /** expéditeur modifié ; absent = nouvel expéditeur */
  senderId: z.string().uuid().optional(),
});

export const SenderIdSchema = z.object({
  senderId: z.string().uuid(),
});
