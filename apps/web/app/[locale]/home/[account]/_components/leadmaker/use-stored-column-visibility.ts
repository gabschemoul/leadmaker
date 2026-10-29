'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { VisibilityState } from '@tanstack/react-table';

import { PROSPECT_COLUMN_IDS } from './prospect-columns';

const listeners = new Set<() => void>();

/** Repli en mémoire quand le stockage navigateur est indisponible. */
const memory = new Map<string, string>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  memory.set(key, value);

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // navigation privée, stockage bloqué : la préférence ne survit pas au rechargement
  }

  listeners.forEach((listener) => listener());
}

function parse(raw: string | null): VisibilityState | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const visibility: VisibilityState = {};

    for (const id of PROSPECT_COLUMN_IDS) {
      const flag = (value as Record<string, unknown>)[id];

      if (typeof flag === 'boolean') {
        visibility[id] = flag;
      }
    }

    return visibility;
  } catch {
    return null;
  }
}

/**
 * Colonnes visibles, mémorisées dans le navigateur sous `storageKey`.
 *
 * Le serveur ne connaît pas ce choix : il rend les colonnes par défaut, puis le
 * navigateur applique la préférence juste après l'hydratation
 * (`useSyncExternalStore` gère ce changement sans erreur d'hydratation).
 */
export function useStoredColumnVisibility(
  storageKey: string,
  defaults: VisibilityState,
) {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(storageKey),
    () => null,
  );

  const visibility = useMemo(() => parse(raw) ?? defaults, [raw, defaults]);

  const setVisibility = useCallback(
    (next: VisibilityState) => write(storageKey, JSON.stringify(next)),
    [storageKey],
  );

  const reset = useCallback(
    () => write(storageKey, JSON.stringify(defaults)),
    [storageKey, defaults],
  );

  return { visibility, setVisibility, reset };
}
