'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

/**
 * Rafraîchit la page quand le robot termine un formulaire (temps réel sur
 * lm_attempts, filtré par la RLS) ; toutes les 10 s en filet de sécurité
 * tant que des formulaires sont en préparation.
 *
 * useEffect justifié : abonnement temps réel ouvert au montage, fermé au démontage.
 */
export function FormsLiveRefresh(props: {
  spaceId: string;
  preparing: number;
}) {
  const client = useSupabase();
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (timer) return;

      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 1500);
    };

    const channel = client
      .channel(`lm-attempts-${props.spaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lm_attempts',
          filter: `space_id=eq.${props.spaceId}`,
        },
        refresh,
      )
      .subscribe();

    const interval =
      props.preparing > 0 ? setInterval(() => router.refresh(), 10_000) : null;

    return () => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
      void client.removeChannel(channel);
    };
  }, [client, router, props.spaceId, props.preparing]);

  return null;
}
