'use client';

import { useEffect, useRef } from 'react';

import { useRouter } from 'next/navigation';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

const THROTTLE_MS = 4_000;

/**
 * Rafraîchit la liste quand un prospect du dossier change (e-mail trouvé par
 * le robot, prospect ajouté par une campagne), en temps réel sur lm_prospects.
 *
 * `paused` : tant que des lignes sont cochées, aucun rafraîchissement (il
 * viderait la sélection ou couperait un dialogue) ; le rafraîchissement manqué
 * est rattrapé dès la reprise.
 *
 * useEffect justifié : abonnement temps réel ouvert au montage, fermé au démontage.
 */
export function ProspectsLiveRefresh(props: {
  spaceId: string;
  paused: boolean;
}) {
  const client = useSupabase();
  const router = useRouter();
  const paused = useRef(props.paused);
  const dirty = useRef(false);
  const lastRefresh = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    paused.current = props.paused;
  }, [props.paused]);

  useEffect(() => {
    const refresh = () => {
      if (paused.current || document.visibilityState !== 'visible') {
        dirty.current = true;
        return;
      }

      if (timer.current) return;

      const wait = Math.max(0, lastRefresh.current + THROTTLE_MS - Date.now());

      timer.current = setTimeout(() => {
        timer.current = null;

        if (paused.current) {
          dirty.current = true;
          return;
        }

        lastRefresh.current = Date.now();
        dirty.current = false;
        router.refresh();
      }, wait);
    };

    const channel = client
      .channel(`lm-prospects-${props.spaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lm_prospects',
          filter: `space_id=eq.${props.spaceId}`,
        },
        refresh,
      )
      .subscribe();

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      void client.removeChannel(channel);
    };
  }, [client, router, props.spaceId]);

  useEffect(() => {
    if (!props.paused && dirty.current) {
      dirty.current = false;
      lastRefresh.current = Date.now();
      router.refresh();
    }
  }, [props.paused, router]);

  return null;
}
