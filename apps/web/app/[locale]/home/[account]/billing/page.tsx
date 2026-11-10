import { Suspense } from 'react';

import { headers } from 'next/headers';

import { TriangleAlert } from 'lucide-react';
import { getTranslations, getLocale } from 'next-intl/server';

import { resolveProductPlan } from '@kit/billing-gateway';
import {
  CurrentLifetimeOrderCard,
  CurrentSubscriptionCard,
} from '@kit/billing-gateway/components';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { If } from '@kit/ui/if';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { CardLoading } from '~/components/skeletons/card-loading';
import { CardSkeleton, Delayed } from '~/components/skeletons/page-skeletons';
import billingConfig from '~/config/billing.config';
import { currencyFor } from '~/lib/leadmaker/billing-currency';

// local imports
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadTeamAccountBillingPage } from '../_lib/server/team-account-billing-page.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { CreditPacksCard } from './_components/credit-packs-card';
import { CreditUsageCard } from './_components/credit-usage-card';
import { TeamAccountCheckoutForm } from './_components/team-account-checkout-form';
import { TeamBillingPortalForm } from './_components/team-billing-portal-form';

interface TeamAccountBillingPageProps {
  params: Promise<{ account: string }>;
}

export const generateMetadata = async () => {
  const t = await getTranslations('teams');
  const title = t('billing.pageTitle');

  return {
    title,
  };
};

/**
 * The header renders from the slug alone; only the billing data waits.
 */
function TeamAccountBillingPage({ params }: TeamAccountBillingPageProps) {
  return (
    <PageBody>
      {/* titre fixe : affiché tout de suite, sans attendre le serveur */}
      <TeamAccountLayoutPageHeader
        title={<Trans i18nKey={'common.routes.billing'} />}
      />

      <div className={'flex flex-col gap-4 pb-32'}>
        {/* les crédits d'abord, sans attendre l'abonnement (qui peut interroger Stripe) : 10/11/2026 */}
        <Suspense
          fallback={
            <CardLoading titleKey={'billing.usage.title'} content={'area'} />
          }
        >
          <CreditsSection params={params} />
        </Suspense>

        <Suspense
          fallback={
            <Delayed className={'flex w-full flex-col'}>
              <CardSkeleton rows={4} />
            </Delayed>
          }
        >
          <TeamAccountBillingContent params={params} />
        </Suspense>
      </div>
    </PageBody>
  );
}

async function CreditsSection({
  params,
}: {
  params: TeamAccountBillingPageProps['params'];
}) {
  const workspace = await loadTeamWorkspace((await params).account);

  return <CreditUsageCard accountId={workspace.account.id} />;
}

async function TeamAccountBillingContent({
  params,
}: {
  params: TeamAccountBillingPageProps['params'];
}) {
  const account = (await params).account;
  const workspace = await loadTeamWorkspace(account);
  const accountId = workspace.account.id;

  const [[subscription, order, customerId], requestHeaders, locale] =
    await Promise.all([
      loadTeamAccountBillingPage(accountId),
      headers(),
      getLocale(),
    ]);

  // euros pour les clients européens, dollars pour les autres (pays donné par Vercel)
  const currency = currencyFor({
    country: requestHeaders.get('x-vercel-ip-country'),
    locale,
  });

  const variantId = subscription?.items[0]?.variant_id;
  const orderVariantId = order?.items[0]?.variant_id;

  const subscriptionProductPlan = variantId
    ? await resolveProductPlan(billingConfig, variantId, subscription.currency)
    : undefined;

  const orderProductPlan = orderVariantId
    ? await resolveProductPlan(billingConfig, orderVariantId, order.currency)
    : undefined;

  const hasBillingData = subscription || order;

  const canManageBilling =
    workspace.account.permissions.includes('billing.manage');

  const shouldShowBillingPortal = canManageBilling && customerId;

  // packs de crédits (10/11/2026) : seulement avec un abonnement en cours
  const canBuyCreditPacks = canManageBilling && Boolean(subscription?.active);

  return (
    <>
      {/* relooking du 8/11/2026 : les crédits d'abord (jauges), puis le forfait sur toute la largeur */}
      <div className={cn('flex flex-col gap-4')}>
        <If condition={!hasBillingData}>
          <If
            condition={canManageBilling}
            fallback={<CannotManageBillingAlert />}
          >
            <TeamAccountCheckoutForm
              customerId={customerId}
              accountId={accountId}
              currency={currency}
            />
          </If>
        </If>

        <If condition={subscription}>
          {(subscription) => {
            return (
              <CurrentSubscriptionCard
                subscription={subscription}
                product={subscriptionProductPlan!.product}
                plan={subscriptionProductPlan!.plan}
              />
            );
          }}
        </If>

        {canBuyCreditPacks ? (
          <CreditPacksCard accountId={accountId} slug={account} />
        ) : null}

        <If condition={order}>
          {(order) => {
            return (
              <CurrentLifetimeOrderCard
                order={order}
                product={orderProductPlan!.product}
                plan={orderProductPlan!.plan}
              />
            );
          }}
        </If>

        {shouldShowBillingPortal ? (
          <TeamBillingPortalForm accountId={accountId} slug={account} />
        ) : null}
      </div>
    </>
  );
}

export default TeamAccountBillingPage;

function CannotManageBillingAlert() {
  return (
    <Alert className={alertExtras.warning}>
      <TriangleAlert className={'h-4'} />

      <AlertTitle>
        <Trans i18nKey={'billing.cannotManageBillingAlertTitle'} />
      </AlertTitle>

      <AlertDescription>
        <Trans i18nKey={'billing.cannotManageBillingAlertDescription'} />
      </AlertDescription>
    </Alert>
  );
}
