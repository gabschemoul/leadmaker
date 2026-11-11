import * as z from 'zod';

import { TODO_KINDS } from '~/lib/leadmaker/todo-query';

/** Un formulaire de « À vous de jouer » (étape Envoi). */
export const TodoAttemptSchema = z.object({
  accountId: z.string().uuid(),
  id: z.string().uuid(),
});

/** « Envoyer » : avec les cases que le robot ne savait pas remplir, si le site en demande. */
export const ApproveTodoSchema = TodoAttemptSchema.extend({
  extraValues: z
    .array(
      z.object({
        label: z.string().max(200),
        value: z.string().trim().max(500),
      }),
    )
    .max(50)
    .optional(),
});

/** « Passer » : un formulaire d'une liste, ou toute la liste (« Tout passer », sans `id`). */
export const SkipTodoSchema = z.object({
  accountId: z.string().uuid(),
  campaignId: z.string().uuid(),
  kind: z.enum(TODO_KINDS),
  id: z.string().uuid().optional(),
});
