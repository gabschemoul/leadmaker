import 'server-only';
import { redirect } from 'next/navigation';

import { createSafeActionClient } from 'next-safe-action';

import { verifyCaptchaToken } from '@kit/auth/captcha/server';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Messages d'erreur renvoyés tels quels au navigateur (audit 5/11/2026, E20) : seulement les clés de traduction
 * (« namespace.cle ») et quelques messages attendus par l'interface. Tout autre message (erreur Postgres,
 * Stripe, réseau…) est journalisé côté serveur et remplacé par un message générique.
 */
const PASSTHROUGH_ERRORS = new Set(['Invalid OTP']);
const TRANSLATION_KEY = /^[a-z][\w-]*(\.[\w-]+)+$/i;

const baseClient = createSafeActionClient({
  handleServerError: (error) => {
    if (
      TRANSLATION_KEY.test(error.message) ||
      PASSTHROUGH_ERRORS.has(error.message)
    ) {
      return error.message;
    }

    console.error('[server action]', error);

    return 'common.genericServerError';
  },
});

/**
 * @name publicActionClient
 * @description Safe action client for public actions that don't require authentication.
 */
export const publicActionClient = baseClient;

/**
 * @name authActionClient
 * @description Safe action client for authenticated actions. Adds user context.
 */
export const authActionClient = baseClient.use(async ({ next }) => {
  const auth = await requireUser(getSupabaseServerClient());

  if (!auth.data) {
    redirect(auth.redirectTo);
  }

  return next({ ctx: { user: auth.data } });
});

/**
 * @name captchaActionClient
 * @description Safe action client for actions that require CAPTCHA and authentication.
 */
export const captchaActionClient = baseClient.use(
  async ({ next, clientInput }) => {
    const input = clientInput as Record<string, unknown>;

    const token =
      typeof input?.captchaToken === 'string' ? input.captchaToken : '';

    await verifyCaptchaToken(token);

    const auth = await requireUser(getSupabaseServerClient());

    if (!auth.data) {
      redirect(auth.redirectTo);
    }

    return next({ ctx: { user: auth.data } });
  },
);
