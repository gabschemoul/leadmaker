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
});

export const CampaignTemplatesFormSchema = z.object({
  messages: z.array(MessageSchema).max(MAX_MESSAGES),
  short: z.object({
    subject: z.string().trim().max(SUBJECT_MAX, { message: TOO_LONG }),
    body: z
      .string()
      .max(SHORT_BODY_MAX, { message: 'outreach.messages.shortTooLong' }),
  }),
});

export type CampaignTemplatesFormValues = z.infer<
  typeof CampaignTemplatesFormSchema
>;

export const SaveCampaignTemplatesSchema = CampaignTemplatesFormSchema.extend({
  accountId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
