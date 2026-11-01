import * as z from 'zod';

import {
  BODY_MAX,
  MAX_MESSAGES,
  SHORT_BODY_MAX,
  SUBJECT_MAX,
} from '~/lib/leadmaker/templates';

const TOO_LONG = 'outreach.messages.tooLong';

const MessageSchema = z.object({
  name: z.string().trim().max(100, { message: TOO_LONG }),
  subject: z.string().trim().max(SUBJECT_MAX, { message: TOO_LONG }),
  body: z.string().max(BODY_MAX, { message: TOO_LONG }),
  // version courte du message, pour les sites qui limitent la longueur
  short: z
    .string()
    .max(SHORT_BODY_MAX, { message: 'outreach.messages.shortTooLong' }),
});

// Plafond de saisie très haut tant qu'il n'y a pas de client (décision Gabriel 1/11/2026) ;
// le vrai plafond est celui du forfait, appliqué par la base à chaque mise en file.
export const DAILY_LIMIT_MAX = 100_000;

export const CampaignTemplatesFormSchema = z.object({
  messages: z.array(MessageSchema).max(MAX_MESSAGES),
  // réglages d'envoi de la campagne
  dailyLimit: z.coerce
    .number()
    .int()
    .min(1, { message: 'outreach.messages.dailyLimitInvalid' })
    .max(DAILY_LIMIT_MAX, { message: 'outreach.messages.dailyLimitInvalid' }),
  autoValidation: z.boolean(),
});

export type CampaignTemplatesFormValues = z.infer<
  typeof CampaignTemplatesFormSchema
>;

export const SaveCampaignTemplatesSchema = CampaignTemplatesFormSchema.extend({
  accountId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
