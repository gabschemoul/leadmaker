import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import pathsConfig from '~/config/paths.config';

interface SpacesPageProps {
  params: Promise<{ account: string }>;
}

/**
 * Ancienne page « Dossiers clients » : la notion n'est plus affichée nulle part (décision du 16/11/2026), toutes
 * les pages montrent l'organisation entière. Gardée pour les anciens liens et favoris : on arrive sur les
 * campagnes.
 */
function SpacesPage({ params }: SpacesPageProps) {
  return (
    <Suspense fallback={null}>
      <RedirectToCampaigns params={params} />
    </Suspense>
  );
}

export default SpacesPage;

async function RedirectToCampaigns({ params }: SpacesPageProps) {
  const { account } = await params;

  redirect(pathsConfig.app.accountCampaigns.replace('[account]', account));

  return null;
}
