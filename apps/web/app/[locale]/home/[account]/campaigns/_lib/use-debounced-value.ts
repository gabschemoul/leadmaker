'use client';

import { useEffect, useState } from 'react';

/**
 * Valeur recopiée après `delay` ms sans changement. L'effet est le moyen
 * direct d'attendre une pause de saisie avant d'interroger le serveur.
 */
export function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);

    return () => clearTimeout(timeout);
  }, [value, delay]);

  return debounced;
}
