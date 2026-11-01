'use client';

import { useEffect, useRef } from 'react';

import { useRouter } from 'next/navigation';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

const THROTTLE_MS = 4_000;
const FALLBACK_MS = 15_000;

/**
 * Rafraîchit la page quand le robot termine un formulaire (temps réel sur
 * lm_attempts, filtré par la RLS) ; toutes les 15 s en filet de sécurité
 * tant que des formulaires sont en préparation.
 *
 * `paused` : pendant une action de l'utilisateur (validation en cours,
 * dialogue ouvert), aucun rafraîchissement — un rafraîchissement concurrent
 * laisse sinon l'action affichée « en cours » tant que la page se recharge.
 * Le rafraîchissement manqué est rattrapé dès la reprise.
 *
 * useEffect justifié : abonnement temps réel ouvert au montage, fermé au démontage.
 */
export function FormsLiveRefresh(props: {
  spaceId: string;
  preparing: number;
  paused: boolean;
  onRefresh?: () => void;
}) {
  const client = useSupabase();
  const router = useRouter();
  const paused = useRef(props.paused);
  const dirty = useRef(false);
  const lastRefresh = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefresh = useRef(props.onRefresh);

  useEffect(() => {
    paused.current = props.paused;
    onRefresh.current = props.onRefresh;
  }, [props.paused, props.onRefresh]);

  useEffect(() => {
    const refresh = () => {
      if (paused.current || document.visibilityState !== 'visible') {
        dirty.current = true;
        return;
      }

      const wait = Math.max(0, lastRefresh.current + THROTTLE_MS - Date.now());

      if (timer.current) return;

      timer.current = setTimeout(() => {
        timer.current = null;

        if (paused.current) {
          dirty.current = true;
          return;
        }

        lastRefresh.current = Date.now();
        dirty.current = false;
        router.refresh();
        onRefresh.current?.();
      }, wait);
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
      props.preparing > 0 ? setInterval(refresh, FALLBACK_MS) : null;

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      if (interval) clearInterval(interval);
      void client.removeChannel(channel);
    };
  }, [client, router, props.spaceId, props.preparing]);

  // reprise après une action : on rattrape le rafraîchissement manqué
  useEffect(() => {
    if (!props.paused && dirty.current) {
      dirty.current = false;
      lastRefresh.current = Date.now();
      router.refresh();
      onRefresh.current?.();
    }
  }, [props.paused, router]);

  return null;
}
