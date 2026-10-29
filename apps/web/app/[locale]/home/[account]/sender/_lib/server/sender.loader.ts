import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

/** Profil expéditeur d'un dossier client (null tant qu'il n'est pas renseigné). */
export async function loadSenderProfile(client: Client, spaceId: string) {
  const { data, error } = await client
    .from('lm_sender_profiles')
    .select(
      'id, civility, first_name, last_name, job_title, company, email, phone, website, address, zip, city, country_code, updated_at',
    )
    .eq('space_id', spaceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export type SenderProfile = NonNullable<
  Awaited<ReturnType<typeof loadSenderProfile>>
>;
