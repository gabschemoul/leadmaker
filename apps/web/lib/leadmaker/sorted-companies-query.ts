import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

/** Onglets de l'écran « Vos entreprises » (jamais d'onglet « Écartées »). */
export type CompaniesTab = 'kept' | 'toCheck';

/** Entreprises lues par page (« Afficher plus » charge la suivante). */
export const COMPANIES_PAGE_SIZE = 50;

/**
 * Filtre PostgREST (`.or(...)` sur lm_campaign_prospects) des entreprises gardées : gardées par le client, ou par
 * le tri pour la cible en cours (`version`) sans choix du client. Partagé par « Vos entreprises » et l'aperçu de
 * « Votre message ».
 */
export function keptCompaniesFilter(version: number) {
  return `client_choice.eq.gardee,and(client_choice.is.null,verdict.eq.gardee,sorted_version.eq.${Math.trunc(version)})`;
}

/**
 * Une page d'entreprises triées d'une campagne (lm_campaign_prospects, lisible par les membres grâce à la
 * RLS), les plus récemment triées d'abord, avec le nom et la ville de l'entreprise, la raison courte du tri et
 * son groupe.
 * - Gardées : gardées par le client, ou par le tri pour la cible en cours (`version`) sans choix du client.
 * - À vérifier : « à vérifier » pour la cible en cours, sans choix du client.
 * Les entreprises écartées ne sont jamais lues.
 */
export async function fetchSortedCompanies(
  client: Client,
  params: {
    campaignId: string;
    version: number;
    tab: CompaniesTab;
    page: number;
    /** langue de l'appli, pour le libellé de l'activité */
    locale?: string;
  },
) {
  const from = params.page * COMPANIES_PAGE_SIZE;

  let query = client
    .from('lm_campaign_prospects')
    .select(
      'prospect_id, reason, group_key, sorted_at, gcid, prospect:lm_prospects(id, name, category, city, rating, review_count, address, phone, website, found_email, is_chain, source, excluded_at, created_at)',
    )
    .eq('campaign_id', params.campaignId);

  query =
    params.tab === 'kept'
      ? // payés seulement : au-delà d'un plafond ou sans crédits, un gardé n'est ni payé ni contactable (11/11)
        query.or(keptCompaniesFilter(params.version)).not('paid_at', 'is', null)
      : query
          .is('client_choice', null)
          .eq('verdict', 'a_verifier')
          .eq('sorted_version', params.version);

  const { data, error } = await query
    .order('sorted_at', { ascending: false, nullsFirst: false })
    .order('prospect_id', { ascending: true })
    .range(from, from + COMPANIES_PAGE_SIZE - 1);

  if (error) {
    throw error;
  }

  // activité dans la langue de l'appli (la fiche garde le libellé anglais de l'annuaire : « Italian restaurant »)
  const gcids = [
    ...new Set((data ?? []).map((row) => row.gcid).filter(Boolean)),
  ] as string[];
  const labels = new Map<string, string>();

  if (gcids.length > 0) {
    const { data: categories } = await client
      .from('lm_categories')
      .select('gcid, label_fr, label_en')
      .in('gcid', gcids);

    for (const category of categories ?? []) {
      labels.set(
        category.gcid,
        params.locale?.startsWith('en') ? category.label_en : category.label_fr,
      );
    }
  }

  return (data ?? []).map((row) => ({
    id: row.prospect_id,
    name: row.prospect?.name ?? '',
    city: row.prospect?.city ?? null,
    website: row.prospect?.website ?? null,
    category:
      (row.gcid ? labels.get(row.gcid) : undefined) ??
      row.prospect?.category ??
      null,
    phone: row.prospect?.phone ?? null,
    /** fiche complète, ouverte au clic (même tiroir que la page Prospects) */
    prospect: row.prospect,
    reason: row.reason,
    /** groupe de l'entreprise (CDC §4.3), null tant que la campagne n'a pas de groupes */
    groupKey: row.group_key,
  }));
}

export type SortedCompany = Awaited<
  ReturnType<typeof fetchSortedCompanies>
>[number];
