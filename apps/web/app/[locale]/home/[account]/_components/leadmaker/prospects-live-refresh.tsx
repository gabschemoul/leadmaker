'use client';

import { useRouter } from 'next/navigation';

import { useRealtimeRefresh } from './use-realtime-refresh';

const THROTTLE_MS = 4_000;

/**
 * Rafraîchit la liste quand un prospect du dossier change (e-mail trouvé par
 * le robot, prospect ajouté par une campagne), en temps réel sur lm_prospects.
 *
 * `paused` : tant que des lignes sont cochées, aucun rafraîchissement (il
 * viderait la sélection ou couperait un dialogue) ; le rafraîchissement manqué
 * est rattrapé dès la reprise.
 */
export function ProspectsLiveRefresh(props: {
  spaceId: string;
  paused: boolean;
  /** liste chargée dans le navigateur : la redemander aussi */
  onChange?: () => void;
}) {
  const router = useRouter();

  useRealtimeRefresh({
    channel: `lm-prospects-${props.spaceId}`,
    table: 'lm_prospects',
    filter: `space_id=eq.${props.spaceId}`,
    throttleMs: THROTTLE_MS,
    paused: props.paused,
    onChange: () => {
      router.refresh();
      props.onChange?.();
    },
  });

  return null;
}
