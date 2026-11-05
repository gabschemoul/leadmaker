'use client';

import { useState } from 'react';

import { Archive, ArchiveRestore } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import { archiveCampaignAction } from '../_lib/server/campaign-lifecycle-actions';

/**
 * Archiver une campagne (avec confirmation) ou la ressortir des archives (audit E18).
 * La logique (pause, arrêt du pilote, formulaires retenus) est dans lm_set_campaign_archived.
 */
export function CampaignArchiveButton(props: {
  campaignId: string;
  archived: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  const archive = useAction(archiveCampaignAction, {
    onSuccess: ({ input }) => {
      setOpen(false);
      toast.success(
        t(
          input.archived
            ? 'campaigns.archive.archivedDone'
            : 'campaigns.archive.restoredDone',
        ),
      );
    },
    onError: ({ error }) => {
      toast.error(t(error.serverError ?? 'campaigns.errors.archiveFailed'));
    },
  });

  if (props.archived) {
    return (
      <Button
        variant={'outline'}
        size={'sm'}
        data-test={'campaign-unarchive-button'}
        disabled={archive.isPending}
        onClick={() =>
          archive.execute({ campaignId: props.campaignId, archived: false })
        }
      >
        <ArchiveRestore className={'w-4'} />
        <span>
          <Trans i18nKey={'campaigns.archive.restoreButton'} />
        </span>
      </Button>
    );
  }

  return (
    <>
      <Button
        variant={'outline'}
        size={'sm'}
        data-test={'campaign-archive-button'}
        onClick={() => setOpen(true)}
      >
        <Archive className={'w-4'} />
        <span>
          <Trans i18nKey={'campaigns.archive.button'} />
        </span>
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!archive.isPending) setOpen(next);
        }}
      >
        <AlertDialogContent data-test={'campaign-archive-dialog'}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans i18nKey={'campaigns.archive.confirmTitle'} />
            </AlertDialogTitle>

            <AlertDialogDescription>
              <Trans i18nKey={'campaigns.archive.confirmDescription'} />
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>
              <Trans i18nKey={'common.cancel'} />
            </AlertDialogCancel>

            <Button
              data-test={'campaign-archive-confirm'}
              disabled={archive.isPending}
              onClick={() =>
                archive.execute({
                  campaignId: props.campaignId,
                  archived: true,
                })
              }
            >
              <Trans i18nKey={'campaigns.archive.confirmButton'} />
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
