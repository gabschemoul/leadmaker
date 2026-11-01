import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import pathsConfig from '~/config/paths.config';

interface MessagesPageProps {
  params: Promise<{ account: string; id: string }>;
}

/**
 * Les messages se rédigent désormais dans l'étape « Rédiger » de la page de
 * campagne. Cette adresse reste pour les anciens liens. La redirection vit
 * derrière une frontière : la page garde une coquille statique.
 */
export default function MessagesPage({ params }: MessagesPageProps) {
  return (
    <Suspense fallback={null}>
      <RedirectToWriteStep params={params} />
    </Suspense>
  );
}

async function RedirectToWriteStep({ params }: MessagesPageProps) {
  const { account, id } = await params;

  redirect(
    `${pathsConfig.app.accountCampaigns.replace('[account]', account)}/${id}?etape=rediger`,
  );

  return null;
}
