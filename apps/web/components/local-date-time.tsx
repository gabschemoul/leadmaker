'use client';

import { useSyncExternalStore } from 'react';

import { useFormatter } from 'next-intl';

const subscribeNoop = () => () => {};

/**
 * Date (et heure) dans le fuseau du navigateur. Le serveur ne connaît pas ce
 * fuseau : il rend en UTC, puis le navigateur réaffiche l'heure locale juste
 * après l'hydratation (useSyncExternalStore évite l'erreur d'hydratation).
 */
export function LocalDateTime(props: {
  value: string;
  dateStyle?: 'short' | 'medium' | 'long';
  /** absent : date seule */
  timeStyle?: 'short' | 'medium';
}) {
  const format = useFormatter();

  const timeZone = useSyncExternalStore(
    subscribeNoop,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => 'UTC',
  );

  return (
    <>
      {format.dateTime(new Date(props.value), {
        dateStyle: props.dateStyle ?? 'short',
        timeStyle: props.timeStyle,
        timeZone,
      })}
    </>
  );
}
