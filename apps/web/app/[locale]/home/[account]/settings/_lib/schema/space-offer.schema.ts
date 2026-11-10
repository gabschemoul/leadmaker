import * as z from 'zod';

/** « Votre offre » d'un dossier (CDC-PARCOURS-TRI-ANNUAIRE §3.1) : même règle que l'écran « Qui ? ». */
export const SpaceOfferFormSchema = z.object({
  offer: z
    .string()
    .trim()
    .min(1, 'campaigns.form.who.offerRequired')
    .max(1000, 'campaigns.form.who.offerTooLong'),
});

export type SpaceOfferFormValues = z.infer<typeof SpaceOfferFormSchema>;

export const SaveSpaceOfferSchema = SpaceOfferFormSchema.extend({
  spaceId: z.uuid(),
});
