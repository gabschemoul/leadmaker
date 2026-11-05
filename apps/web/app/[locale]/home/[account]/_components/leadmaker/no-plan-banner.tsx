import Link from 'next/link';

import { CreditCard } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';

import pathsConfig from '~/config/paths.config';

/**
 * Bandeau en haut de l'appli tant que l'organisation n'a ni forfait ni crédits (audit 5/11/2026, E6) :
 * sans lui, un nouvel inscrit préparait sa campagne puis butait sur « plus de crédits » au lancement.
 * Rendu dans le layout de l'équipe, derrière un <Suspense> (lecture de la base).
 */
export async function NoPlanBanner(props: { accountId: string; slug: string }) {
  const client = getSupabaseServerClient();

  const { data } = await client
    .from('lm_account_credits')
    .select('plan_id, discovery_balance, outreach_balance')
    .eq('account_id', props.accountId)
    .maybeSingle();

  const hasPlan =
    Boolean(data?.plan_id) ||
    (data?.discovery_balance ?? 0) > 0 ||
    (data?.outreach_balance ?? 0) > 0;

  if (hasPlan) {
    return null;
  }

  const t = await getTranslations('campaigns.noPlan');
  const billingPath = pathsConfig.app.accountBilling.replace(
    '[account]',
    props.slug,
  );

  return (
    <div className={'px-4 pt-4 lg:px-6'}>
      <Alert data-test={'no-plan-banner'}>
        <CreditCard className={'size-4'} />
        <AlertTitle>{t('title')}</AlertTitle>
        <AlertDescription
          className={
            'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'
          }
        >
          <span>{t('description')}</span>

          <Button
            size={'sm'}
            nativeButton={false}
            className={'shrink-0 no-underline'}
            render={<Link href={billingPath} />}
          >
            {t('button')}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
