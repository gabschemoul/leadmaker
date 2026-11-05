'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

import { prepareCampaignAction } from '../../_lib/server/campaign-outreach-actions';

/**
 * Met en préparation les prospects de la campagne pas encore traités,
 * puis rafraîchit la page : les compteurs de l'étape Contacter bougent.
 * Pendant l'appel ET le rafraîchissement : roue qui tourne + « Préparation en cours… » (5/11/2026).
 * Erreur : message affiché 10 s (avant, il passait inaperçu).
 */
export function PrepareCampaignButton(props: {
  campaignId: string;
  disabled: boolean;
  label: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const prepare = useAction(prepareCampaignAction, {
    onSuccess: ({ data }) => {
      toast.success(
        t('outreach.forms.prepare.done', {
          queued: data?.queued ?? 0,
          skipped: data?.skipped ?? 0,
        }),
      );
      startRefresh(() => router.refresh());
    },
    onError: ({ error }) => {
      const key = error.serverError ?? '';

      toast.error(
        t(key.startsWith('outreach.') ? key : 'outreach.forms.prepare.failed'),
        { duration: 10_000 },
      );
    },
  });

  const loading = prepare.isPending || refreshing;

  return (
    <Button
      className={'mt-auto'}
      data-test={'campaign-prepare-button'}
      disabled={props.disabled}
      loading={loading}
      onClick={() => prepare.execute({ campaignId: props.campaignId })}
    >
      <FileText className={'w-4'} />
      <span>{loading ? t('outreach.forms.prepare.working') : props.label}</span>
    </Button>
  );
}
