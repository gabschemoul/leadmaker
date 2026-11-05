'use client';

import { useEffect, useRef } from 'react';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

/**
 * Rafraîchissement en temps réel d'un écran : écoute les changements d'une table
 * (Supabase Realtime, filtré par la RLS) et appelle `onChange` au plus une fois
 * toutes les `throttleMs`. Lecture seule : aucune écriture en base.
 *
 * - `paused` : pendant une action de l'utilisateur (sélection, dialogue,
 *   validation en cours), aucun appel ; le changement manqué est rattrapé dès
 *   la reprise. Idem quand l'onglet est caché.
 * - `fallbackMs` : si renseigné, appel périodique en filet de sécurité (même
 *   règles de pause et de cadence), au cas où la connexion temps réel tombe.
 *
 * useEffect justifié : abonnement temps réel ouvert au montage, fermé au démontage.
 */
export function useRealtimeRefresh(params: {
  /** nom unique du canal Realtime, ex. `lm-attempts-<spaceId>` */
  channel: string;
  table: string;
  /** filtre PostgREST, ex. `space_id=eq.<id>` */
  filter: string;
  throttleMs: number;
  paused: boolean;
  onChange: () => void;
  fallbackMs?: number | null;
}) {
  const { channel: channelName, table, filter, throttleMs } = params;
  const fallbackMs = params.fallbackMs ?? null;

  const client = useSupabase();
  const paused = useRef(params.paused);
  const dirty = useRef(false);
  const lastRefresh = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = useRef(params.onChange);

  useEffect(() => {
    paused.current = params.paused;
    onChange.current = params.onChange;
  }, [params.paused, params.onChange]);

  useEffect(() => {
    const refresh = () => {
      if (paused.current || document.visibilityState !== 'visible') {
        dirty.current = true;
        return;
      }

      if (timer.current) return;

      const wait = Math.max(0, lastRefresh.current + throttleMs - Date.now());

      timer.current = setTimeout(() => {
        timer.current = null;

        if (paused.current) {
          dirty.current = true;
          return;
        }

        lastRefresh.current = Date.now();
        dirty.current = false;
        onChange.current();
      }, wait);
    };

    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter },
        refresh,
      )
      .subscribe();

    const interval = fallbackMs ? setInterval(refresh, fallbackMs) : null;

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      if (interval) clearInterval(interval);
      void client.removeChannel(channel);
    };
  }, [client, channelName, table, filter, throttleMs, fallbackMs]);

  // reprise après une action : on rattrape le rafraîchissement manqué
  useEffect(() => {
    if (!params.paused && dirty.current) {
      dirty.current = false;
      lastRefresh.current = Date.now();
      onChange.current();
    }
  }, [params.paused]);
}
