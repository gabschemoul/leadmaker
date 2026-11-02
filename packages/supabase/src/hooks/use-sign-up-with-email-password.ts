import { useMutation } from '@tanstack/react-query';

import { useSupabase } from './use-supabase';

interface Credentials {
  email: string;
  password: string;
  emailRedirectTo: string;
  captchaToken?: string;
  // Langue de l'interface au moment de l'inscription : gardée dans les données
  // de l'utilisateur (user_metadata.lang) pour que les e-mails de confirmation
  // et de mot de passe partent dans cette langue.
  language?: string;
}

const _WeakPasswordReasons = ['length', 'characters', 'pwned'] as const;

export type WeakPasswordReason = (typeof _WeakPasswordReasons)[number];

export class WeakPasswordError extends Error {
  readonly code = 'weak_password';
  readonly reasons: WeakPasswordReason[];

  constructor(reasons: WeakPasswordReason[]) {
    super('weak_password');
    this.name = 'WeakPasswordError';
    this.reasons = reasons;
  }
}

export function useSignUpWithEmailAndPassword() {
  const client = useSupabase();
  const mutationKey = ['auth', 'sign-up-with-email-password'];

  const mutationFn = async (params: Credentials) => {
    const { emailRedirectTo, captchaToken, language, ...credentials } = params;

    const response = await client.auth.signUp({
      ...credentials,
      options: {
        emailRedirectTo,
        captchaToken,
        data: language ? { lang: language } : undefined,
      },
    });

    if (response.error) {
      // Handle weak password errors specially (AuthWeakPasswordError from Supabase)
      if (response.error.code === 'weak_password') {
        const errorObj = response.error as unknown as {
          reasons?: WeakPasswordReason[];
        };

        throw new WeakPasswordError(errorObj.reasons ?? []);
      }

      throw response.error;
    }

    const user = response.data?.user;
    const identities = user?.identities ?? [];

    // if the user has no identities, it means that the email is taken
    if (identities.length === 0) {
      throw new Error('User already registered');
    }

    return response.data;
  };

  return useMutation({
    mutationKey,
    mutationFn,
  });
}
