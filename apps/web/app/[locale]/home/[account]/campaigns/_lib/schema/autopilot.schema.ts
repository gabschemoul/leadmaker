import * as z from 'zod';

import { MAX_MESSAGES } from '~/lib/leadmaker/templates';

/** Rythmes d'envoi du pilote automatique (même liste que l'énumération SQL lm_autopilot_schedule). */
export const AUTOPILOT_SCHEDULES = ['office', 'spread', 'continuous'] as const;

export type AutopilotSchedule = (typeof AUTOPILOT_SCHEDULES)[number];

/** Durées proposées pour « Étalé sur plusieurs jours » (jours ouvrés). */
export const AUTOPILOT_SPREAD_DAYS = [3, 5, 10, 20] as const;

const SettingsSchema = z.object({
  target: z.number().int().min(1).max(1_000_000),
  messages: z.array(z.string().trim().min(1).max(255)).min(1).max(MAX_MESSAGES),
  schedule: z.enum(AUTOPILOT_SCHEDULES),
  spreadDays: z.number().int().min(1).max(60),
});

export type AutopilotSettings = z.infer<typeof SettingsSchema>;

export const StartAutopilotSchema = SettingsSchema.extend({
  campaignId: z.string().uuid(),
  preview: z.boolean(),
});

export const UpdateAutopilotSchema = SettingsSchema.extend({
  autopilotId: z.string().uuid(),
});

export const AutopilotIdSchema = z.object({
  autopilotId: z.string().uuid(),
});
