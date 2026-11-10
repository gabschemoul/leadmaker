import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import pathsConfig from '~/config/paths.config';

interface TeamAccountHomePageProps {
  params: Promise<{ account: string }>;
}

/**
 * Accueil d'une organisation : il n'y a plus de tableau de bord (10/11/2026, « il ne sert à rien pour
 * l'instant ») ; on arrive sur les campagnes. Gardée pour les anciens liens et favoris.
 */
function TeamAccountHomePage({ params }: TeamAccountHomePageProps) {
  return (
    <Suspense fallback={null}>
      <RedirectToCampaigns params={params} />
    </Suspense>
  );
}

export default TeamAccountHomePage;

async function RedirectToCampaigns({ params }: TeamAccountHomePageProps) {
  const { account } = await params;

  redirect(pathsConfig.app.accountCampaigns.replace('[account]', account));

  return null;
}
