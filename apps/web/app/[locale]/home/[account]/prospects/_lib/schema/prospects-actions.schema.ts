import * as z from 'zod';

/** Limite d'une action groupée : au plus 2 000 prospects à la fois. */
export const PROSPECTS_BATCH_LIMIT = 2000;

/**
 * Identité de l'organisation (immuable, contrairement au slug) et prospects
 * ciblés. Le RLS des fonctions SQL ne touche que les lignes de l'organisation
 * du membre : un identifiant étranger est simplement ignoré.
 */
export const ProspectIdsSchema = z.object({
  accountId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1).max(PROSPECTS_BATCH_LIMIT),
});

export type ProspectIdsInput = z.output<typeof ProspectIdsSchema>;

/** Préparation des formulaires : campagne facultative pour les prospects importés sans campagne. */
export const PrepareProspectsSchema = ProspectIdsSchema.extend({
  campaignId: z.string().uuid().nullable(),
});

export type PrepareProspectsInput = z.output<typeof PrepareProspectsSchema>;
