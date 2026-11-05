'use client';

import { Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import { duplicateCampaignAction } from '../_lib/server/campaign-lifecycle-actions';
import { CampaignArchiveButton } from './campaign-archive-button';

/** Actions secondaires d'une campagne, dans l'en-tête : dupliquer, exporter, archiver. */
export function CampaignHeaderActions(props: {
  campaignId: string;
  campaignName: string;
  accountSlug: string;
  archived: boolean;
}) {
  const t = useTranslations();

  const duplicate = useAction(duplicateCampaignAction, {
    onError: ({ error }) => {
      toast.error(t(error.serverError ?? 'campaigns.errors.duplicateFailed'));
    },
  });

  return (
    <div className={'flex flex-wrap gap-2'}>
      <Button
        variant={'outline'}
        size={'sm'}
        data-test={'campaign-duplicate-button'}
        loading={duplicate.isPending}
        onClick={() =>
          duplicate.execute({
            campaignId: props.campaignId,
            accountSlug: props.accountSlug,
            name: t('campaigns.duplicate.copyName', {
              name: props.campaignName,
            }).slice(0, 255),
          })
        }
      >
        <Copy className={'w-4'} />

        <span>
          <Trans
            i18nKey={
              duplicate.isPending
                ? 'campaigns.duplicate.pending'
                : 'campaigns.duplicate.button'
            }
          />
        </span>
      </Button>

      <Button
        variant={'outline'}
        size={'sm'}
        nativeButton={false}
        data-test={'campaign-export-button'}
        render={
          <a
            href={`/api/leadmaker/export?campaign_id=${props.campaignId}`}
            download
          />
        }
      >
        <Download className={'w-4'} />

        <span>
          <Trans i18nKey={'prospects.export.button'} />
        </span>
      </Button>

      <CampaignArchiveButton
        campaignId={props.campaignId}
        archived={props.archived}
      />
    </div>
  );
}
