import * as z from 'zod';

import {
  BODY_MAX,
  MAX_MESSAGES,
  MAX_VERSIONS_PER_GROUP,
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
  // groupe de la campagne visé (« Un message par groupe ») ; absent ou null = « Pour les autres »
  group: z.string().trim().max(60).nullable().optional(),
});

/**
 * Règles sur l'ensemble des messages remplis (les cases vides ne sont pas enregistrées) : au plus 4 versions par
 * groupe (« Pour les autres » compte comme un groupe), et des noms tous différents dans la campagne (robots,
 * pilote automatique et résultats s'y retrouvent par le nom).
 */
function checkMessages(
  messages: Array<z.infer<typeof MessageSchema>>,
  ctx: z.RefinementCtx,
) {
  const perGroup = new Map<string, number>();
  const names = new Map<string, number>();

  messages.forEach((message, index) => {
    if (message.body.trim() === '') return;

    const group = message.group?.trim() || '';
    const count = (perGroup.get(group) ?? 0) + 1;

    perGroup.set(group, count);

    if (count > MAX_VERSIONS_PER_GROUP) {
      ctx.addIssue({
        code: 'custom',
        path: ['messages', index, 'body'],
        message: 'campaigns.messages.tooManyVersions',
      });
    }

    const name = message.name.trim().toLowerCase();

    if (name === '') return;

    if (names.has(name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['messages', index, 'name'],
        message: 'campaigns.messages.nameTaken',
      });
    } else {
      names.set(name, index);
    }
  });
}

// Plafond de saisie très haut tant qu'il n'y a pas de client (décision Gabriel 1/11/2026) ;
// le vrai plafond est celui du forfait, appliqué par la base à chaque mise en file.
export const DAILY_LIMIT_MAX = 100_000;

const CampaignTemplatesBaseSchema = z.object({
  messages: z.array(MessageSchema).max(MAX_MESSAGES),
  // réglages d'envoi de la campagne
  dailyLimit: z.coerce
    .number()
    .int()
    .min(1, { message: 'outreach.messages.dailyLimitInvalid' })
    .max(DAILY_LIMIT_MAX, { message: 'outreach.messages.dailyLimitInvalid' }),
  autoValidation: z.boolean(),
});

export const CampaignTemplatesFormSchema =
  CampaignTemplatesBaseSchema.superRefine((values, ctx) =>
    checkMessages(values.messages, ctx),
  );

export type CampaignTemplatesFormValues = z.infer<
  typeof CampaignTemplatesFormSchema
>;

export const SaveCampaignTemplatesSchema = CampaignTemplatesBaseSchema.extend({
  accountId: z.string().uuid(),
  campaignId: z.string().uuid(),
}).superRefine((values, ctx) => checkMessages(values.messages, ctx));

/** Réglages d'envoi du mode avancé (fenêtre « Réglages d'envoi » de l'étape Contacter, audit E10). */
export const CampaignSendingSchema = z.object({
  campaignId: z.string().uuid(),
  dailyLimit: z.coerce
    .number()
    .int()
    .min(1, { message: 'outreach.messages.dailyLimitInvalid' })
    .max(DAILY_LIMIT_MAX, { message: 'outreach.messages.dailyLimitInvalid' }),
  autoValidation: z.boolean(),
});
