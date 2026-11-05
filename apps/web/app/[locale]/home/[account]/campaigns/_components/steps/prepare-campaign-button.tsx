'use client';

import { useRouter } from 'next/navigation';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

import { prepareCampaignAction } from '../../_lib/server/campaign-outreach-actions';

/**
 * Met en préparation tous les prospects de la campagne pas encore traités,
 * puis rafraîchit la page : les compteurs de l'étape Contacter bougent.
 */
export function PrepareCampaignButton(props: {
  campaignId: string;
  disabled: boolean;
  label: string;
}) {
  const t = useTranslations('outreach.forms.prepare');
  const router = useRouter();

  const prepare = useAction(prepareCampaignAction, {
    onSuccess: ({ data }) => {
      toast.success(
        t('done', { queued: data?.queued ?? 0, skipped: data?.skipped ?? 0 }),
      );
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(
        t(
          (error.serverError ?? 'outreach.forms.prepare.failed').replace(
            'outreach.forms.prepare.',
            '',
          ),
        ),
      ),
  });

  return (
    <Button
      className={'mt-auto'}
      data-test={'campaign-prepare-button'}
      disabled={props.disabled || prepare.isPending}
      onClick={() => prepare.execute({ campaignId: props.campaignId })}
    >
      <FileText className={'w-4'} />
      <span>{props.label}</span>
    </Button>
  );
}
