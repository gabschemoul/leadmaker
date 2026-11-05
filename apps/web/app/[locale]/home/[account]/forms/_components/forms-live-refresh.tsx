'use client';

import { useRouter } from 'next/navigation';

import { useRealtimeRefresh } from '../../_components/leadmaker/use-realtime-refresh';

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
 */
export function FormsLiveRefresh(props: {
  spaceId: string;
  preparing: number;
  paused: boolean;
  onRefresh?: () => void;
}) {
  const router = useRouter();
  const { onRefresh } = props;

  useRealtimeRefresh({
    channel: `lm-attempts-${props.spaceId}`,
    table: 'lm_attempts',
    filter: `space_id=eq.${props.spaceId}`,
    throttleMs: THROTTLE_MS,
    fallbackMs: props.preparing > 0 ? FALLBACK_MS : null,
    paused: props.paused,
    onChange: () => {
      router.refresh();
      onRefresh?.();
    },
  });

  return null;
}
