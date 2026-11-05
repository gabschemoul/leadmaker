'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

/**
 * Rôle : fine barre de progression en haut de l'écran pendant un changement de page (5/11/2026, retour de
 * Gabriel : « quand tu cliques sur un lien il n'y a rien qui montre que ça charge »).
 * Démarre au clic sur un lien interne (<a>/<Link>) qui mène à une autre adresse ; s'arrête quand Next.js inscrit
 * la nouvelle adresse dans l'historique (pushState/replaceState, c.-à-d. nouvelle page affichée) ou au retour
 * arrière. Sécurité : se termine seule au bout de 20 s (navigation annulée, lien intercepté…).
 * Pas de usePathname/useSearchParams : ils rendraient dynamiques les pages statiques du site public.
 * Utilisation : monté une seule fois dans la mise en page racine ; aucun réglage par lien. Pour une navigation
 * lancée par le code (filtres, tri…), utiliser `useProgressRouter()` à la place de `useRouter()`.
 */
const START_EVENT = 'lm-navigation-start';

/** Démarre la barre pour une navigation lancée par le code (ignoré si l'adresse ne change pas). */
export function startNavigationProgress(href: string) {
  const next = new URL(href, window.location.href);

  if (
    next.pathname === window.location.pathname &&
    next.search === window.location.search
  ) {
    return;
  }

  window.dispatchEvent(new Event(START_EVENT));
}

/** `useRouter()` dont `push` et `replace` affichent la barre de chargement. */
export function useProgressRouter() {
  const router = useRouter();

  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        startNavigationProgress(args[0]);
        router.push(...args);
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        startNavigationProgress(args[0]);
        router.replace(...args);
      },
    }),
    [router],
  );
}

type Phase = 'idle' | 'loading' | 'done';

export function NavigationProgress() {
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clearTimers = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };

    const finish = () => {
      clearTimers();
      setPhase((current) => (current === 'loading' ? 'done' : current));
      timers.current.push(window.setTimeout(() => setPhase('idle'), 450));
    };

    const onClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest?.('a');

      if (
        !anchor ||
        !anchor.href ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      ) {
        return;
      }

      const next = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);

      if (
        next.origin !== current.origin ||
        (next.pathname === current.pathname && next.search === current.search)
      ) {
        return;
      }

      start();
    };

    const start = () => {
      clearTimers();
      setPhase('loading');
      timers.current.push(window.setTimeout(finish, 20_000));
    };

    // Next.js écrit l'adresse dans l'historique une fois la nouvelle page affichée.
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;

    const patchedPush: History['pushState'] = function (
      this: History,
      ...args
    ) {
      originalPush.apply(this, args);
      finish();
    };

    const patchedReplace: History['replaceState'] = function (
      this: History,
      ...args
    ) {
      originalReplace.apply(this, args);
      finish();
    };

    window.history.pushState = patchedPush;
    window.history.replaceState = patchedReplace;

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', finish);
    window.addEventListener(START_EVENT, start);

    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', finish);
      window.removeEventListener(START_EVENT, start);
      // ne remet l'original que si personne (Next.js) n'a repris la main entre-temps
      if (window.history.pushState === patchedPush) {
        window.history.pushState = originalPush;
      }

      if (window.history.replaceState === patchedReplace) {
        window.history.replaceState = originalReplace;
      }
      clearTimers();
    };
  }, []);

  if (phase === 'idle') {
    return null;
  }

  return (
    <div
      aria-hidden
      data-test={'navigation-progress'}
      className={'pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]'}
    >
      <div
        className={'bg-primary h-full'}
        style={
          phase === 'loading'
            ? {
                width: '85%',
                animation:
                  'lm-nav-progress 8s cubic-bezier(0.1, 0.7, 0.2, 1) both',
              }
            : {
                width: '100%',
                opacity: 0,
                transition: 'width 200ms ease-out, opacity 250ms ease 150ms',
              }
        }
      />
      <style>{`@keyframes lm-nav-progress { from { width: 0% } to { width: 85% } }`}</style>
    </div>
  );
}
