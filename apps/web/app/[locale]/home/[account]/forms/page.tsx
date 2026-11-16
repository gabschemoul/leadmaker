import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import pathsConfig from '~/config/paths.config';

interface FormsPageProps {
  params: Promise<{ account: string }>;
}

/**
 * Ancienne page « Formulaires » : retirée le 16/11/2026 (décision de Gabriel). Le robot fait tout ce qu'il peut,
 * ce qui reste au client est dans l'étape Envoi de chaque campagne. Gardée pour les anciens liens et favoris : on
 * arrive sur les campagnes.
 */
function FormsPage({ params }: FormsPageProps) {
  return (
    <Suspense fallback={null}>
      <RedirectToCampaigns params={params} />
    </Suspense>
  );
}

export default FormsPage;

async function RedirectToCampaigns({ params }: FormsPageProps) {
  const { account } = await params;

  redirect(pathsConfig.app.accountCampaigns.replace('[account]', account));

  return null;
}
