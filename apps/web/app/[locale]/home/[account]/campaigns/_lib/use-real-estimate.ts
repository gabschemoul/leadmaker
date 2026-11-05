'use client';

import { useState, useTransition } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

import { requestEstimateAction } from './server/estimate-actions';

export type RealEstimateFilters = {
  rating_min: number;
  rating_max: number;
  min_reviews: number;
  website: 'with' | 'without' | 'all';
  exclude_public: boolean;
  main_category_only: boolean;
  extra_exclusions: string[];
};

type EstimateRow = {
  id: string;
  status: string;
  mode: string;
  total_searches: number;
  sample_searches: number;
  done_searches: number;
  expected: number | null;
  expected_low: number | null;
  expected_high: number | null;
  /** part des fiches lues qui passent les filtres (0 à 1) */
  rate: number | null;
  /** crédits de prospection par prospect qui en découlent (roadmap n°13) */
  credits_per_prospect: number | null;
};

export type RealEstimateState = ReturnType<typeof useRealEstimate>;

/**
 * Estimation réelle d'une campagne : demande au worker de lire Google Maps puis suit
 * l'avancement toutes les 3 secondes. `stale` indique que les critères ont changé depuis.
 */
export function useRealEstimate(accountId: string, key: string | null) {
  const client = useSupabase();
  const [state, setState] = useState<{ id: string; key: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const { data: result } = useQuery({
    queryKey: ['lm-real-estimate', state?.id],
    enabled: Boolean(state?.id),
    refetchInterval: (query) =>
      (query.state.data as EstimateRow | undefined)?.status === 'running'
        ? 3000
        : false,
    queryFn: async () => {
      const { data, error } = await client
        .from('lm_estimates')
        .select(
          'id, status, mode, total_searches, sample_searches, done_searches, expected, expected_low, expected_high, rate, credits_per_prospect',
        )
        .eq('id', state!.id)
        .single();

      if (error) {
        throw error;
      }

      return data as EstimateRow;
    },
  });

  const request = () => {
    if (!key) {
      return;
    }

    const input = JSON.parse(key) as {
      countryCode: string;
      targeting: Parameters<typeof requestEstimateAction>[0]['targeting'];
      filters: RealEstimateFilters;
    };

    startTransition(async () => {
      const response = await requestEstimateAction({ accountId, ...input });

      if (response?.data?.estimateId) {
        setState({ id: response.data.estimateId, key });
      }
    });
  };

  return {
    result: state ? result : undefined,
    stale: state !== null && state.key !== key,
    pending,
    request,
  };
}
