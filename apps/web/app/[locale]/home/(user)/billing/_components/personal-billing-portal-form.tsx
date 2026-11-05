'use client';

import { useAction } from 'next-safe-action/hooks';

import { BillingPortalCard } from '@kit/billing-gateway/components';

import { createPersonalAccountBillingPortalSession } from '../_lib/server/server-actions';

export function PersonalBillingPortalForm() {
  const { execute, isPending } = useAction(
    createPersonalAccountBillingPortalSession,
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        execute();
      }}
    >
      {/* roue sur le bouton pendant la création de la session du portail */}
      <BillingPortalCard pending={isPending} />
    </form>
  );
}
