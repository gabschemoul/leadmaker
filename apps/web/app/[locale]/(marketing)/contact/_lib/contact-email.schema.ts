import * as z from 'zod';

export const ContactEmailSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  message: z.string().min(1).max(5000),
  // Piège à robots de spam (audit E22) : champ invisible pour un humain ; rempli = message ignoré
  website: z.string().max(200).optional(),
});
