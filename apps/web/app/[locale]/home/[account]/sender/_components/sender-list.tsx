'use client';

import { useState } from 'react';

import { Plus } from 'lucide-react';
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
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { senderLabel } from '../_lib/sender-label';
import {
  deleteSenderAction,
  setDefaultSenderAction,
} from '../_lib/server/server-actions';

interface SenderRow {
  id: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  is_default: boolean;
}

/**
 * Les expéditeurs de l'organisation : celui par défaut sert aux campagnes qui
 * n'en choisissent pas. « Modifier » ouvre le formulaire en dessous.
 */
export function SenderList(props: {
  senders: SenderRow[];
  selectedId: string | null;
  /** affiche le formulaire de cet expéditeur (ou d'un nouveau) sans recharger la page */
  onSelect: (id: string | 'new') => void;
}) {
  const t = useTranslations();
  const [deleting, setDeleting] = useState<SenderRow | null>(null);

  const setDefault = useAction(setDefaultSenderAction, {
    onSuccess: () => toast.success(t('outreach.sender.defaultSaved')),
    onError: ({ error }) =>
      toast.error(t(error.serverError ?? 'outreach.sender.saveFailed')),
  });

  const remove = useAction(deleteSenderAction, {
    onSuccess: () => {
      setDeleting(null);
      toast.success(t('outreach.sender.deleted'));
    },
    onError: ({ error }) =>
      toast.error(t(error.serverError ?? 'outreach.sender.deleteFailed')),
  });

  const busy = setDefault.isPending || remove.isPending;

  return (
    <div className={'flex flex-col gap-3'} data-test={'sender-list'}>
      <ul className={'flex flex-col divide-y rounded-lg border'}>
        {props.senders.map((sender) => (
          <li
            key={sender.id}
            data-test={'sender-row'}
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 px-4 py-3',
              props.selectedId === sender.id && 'bg-muted/50',
            )}
          >
            <div className={'flex min-w-0 flex-col'}>
              <span className={'flex items-center gap-2 text-sm font-medium'}>
                <span className={'truncate'}>{senderLabel(sender)}</span>

                {sender.is_default ? (
                  <Badge variant={'secondary'} data-test={'sender-default'}>
                    <Trans i18nKey={'outreach.sender.defaultBadge'} />
                  </Badge>
                ) : null}
              </span>

              <span className={'text-muted-foreground truncate text-sm'}>
                {sender.email}
              </span>
            </div>

            <div className={'flex flex-wrap items-center gap-2'}>
              {sender.is_default ? null : (
                <Button
                  type={'button'}
                  size={'sm'}
                  variant={'ghost'}
                  disabled={busy}
                  loading={
                    setDefault.isPending &&
                    setDefault.input?.senderId === sender.id
                  }
                  data-test={'sender-make-default'}
                  onClick={() => setDefault.execute({ senderId: sender.id })}
                >
                  <Trans i18nKey={'outreach.sender.makeDefault'} />
                </Button>
              )}

              <Button
                type={'button'}
                size={'sm'}
                variant={'outline'}
                data-test={'sender-edit'}
                onClick={() => props.onSelect(sender.id)}
              >
                <Trans i18nKey={'outreach.sender.edit'} />
              </Button>

              <Button
                type={'button'}
                size={'sm'}
                variant={'ghost'}
                className={'text-destructive'}
                disabled={busy}
                data-test={'sender-delete'}
                onClick={() => setDeleting(sender)}
              >
                <Trans i18nKey={'outreach.sender.delete'} />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div>
        <Button
          type={'button'}
          size={'sm'}
          variant={'outline'}
          data-test={'sender-add'}
          onClick={() => props.onSelect('new')}
        >
          <Plus className={'mr-1.5 size-4'} />
          <Trans i18nKey={'outreach.sender.add'} />
        </Button>
      </div>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? null : setDeleting(null))}
      >
        <AlertDialogContent data-test={'sender-delete-dialog'}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans i18nKey={'outreach.sender.deleteTitle'} />
            </AlertDialogTitle>

            <AlertDialogDescription>
              <Trans
                i18nKey={'outreach.sender.deleteDescription'}
                values={{ name: deleting ? senderLabel(deleting) : '' }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              <Trans i18nKey={'common.cancel'} />
            </AlertDialogCancel>

            <Button
              type={'button'}
              variant={'destructive'}
              loading={remove.isPending}
              data-test={'sender-delete-confirm'}
              onClick={() =>
                deleting ? remove.execute({ senderId: deleting.id }) : null
              }
            >
              <Trans i18nKey={'outreach.sender.delete'} />
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
