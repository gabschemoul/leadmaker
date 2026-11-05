'use client';

import { useAction } from 'next-safe-action/hooks';

import { BillingPortalCard } from '@kit/billing-gateway/components';

import { createBillingPortalSession } from '../_lib/server/server-actions';

export function TeamBillingPortalForm({
  accountId,
  slug,
}: {
  accountId: string;
  slug: string;
}) {
  const { execute, isPending } = useAction(createBillingPortalSession);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        execute({ accountId, slug });
      }}
    >
      {/* roue sur le bouton pendant la création de la session du portail */}
      <BillingPortalCard pending={isPending} />
    </form>
  );
}
