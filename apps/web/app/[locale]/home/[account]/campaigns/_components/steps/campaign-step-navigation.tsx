'use client';

/**
 * Changement d'étape instantané (10/11/2026, « ce n'est pas fluide ») : au clic sur un onglet, l'onglet
 * s'allume tout de suite et une silhouette remplace l'étape précédente, le temps que le serveur prépare la
 * nouvelle (avant, l'écran restait figé 3 à 5 s sur l'ancienne étape).
 * Le rail (CampaignStepsRail) appelle `go` ; le contenu (CampaignStepContent) affiche la silhouette.
 */
import { createContext, useContext, useState, useTransition } from 'react';

import { useProgressRouter } from '~/components/navigation-progress';
import { CardSkeleton } from '~/components/skeletons/page-skeletons';

import type { CampaignStep } from '../../_lib/steps';

interface StepNavigation {
  /** étape affichée dans le rail : celle demandée pendant le chargement, sinon celle du serveur */
  shown: CampaignStep;
  /** une autre étape est en cours de chargement */
  loading: boolean;
  go: (step: CampaignStep, href: string) => void;
}

const StepNavigationContext = createContext<StepNavigation | null>(null);

export function CampaignStepNavigation(props: {
  active: CampaignStep;
  children: React.ReactNode;
}) {
  const router = useProgressRouter();
  const [isPending, startTransition] = useTransition();
  const [requested, setRequested] = useState<CampaignStep | null>(null);

  const loading = isPending && requested !== null && requested !== props.active;

  const go = (step: CampaignStep, href: string) => {
    if (step === props.active && !isPending) {
      return;
    }

    setRequested(step);
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  };

  return (
    <StepNavigationContext.Provider
      value={{
        shown: loading && requested ? requested : props.active,
        loading,
        go,
      }}
    >
      {props.children}
    </StepNavigationContext.Provider>
  );
}

export function useStepNavigation() {
  return useContext(StepNavigationContext);
}

/** Contenu de l'étape, remplacé par une silhouette pendant le chargement d'une autre étape. */
export function CampaignStepContent(props: { children: React.ReactNode }) {
  const navigation = useStepNavigation();

  if (navigation?.loading) {
    return (
      <div
        className={'flex flex-col gap-4'}
        aria-busy={true}
        data-test={'campaign-step-loading'}
      >
        <CardSkeleton rows={2} />
        <CardSkeleton rows={6} />
      </div>
    );
  }

  return <>{props.children}</>;
}
