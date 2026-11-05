'use client';

import { useState } from 'react';

import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import {
  deleteSpaceAction,
  renameSpaceAction,
} from '../_lib/server/server-actions';

/**
 * Renommer / supprimer un dossier client (audit E16). La suppression demande de retaper le nom du dossier :
 * elle efface aussi ses campagnes, prospects et formulaires. Le dossier par défaut ne se supprime pas.
 */
export function SpaceRowActions(props: {
  accountId: string;
  spaceId: string;
  name: string;
  isDefault: boolean;
}) {
  const t = useTranslations();
  const [mode, setMode] = useState<'rename' | 'delete' | null>(null);
  const [value, setValue] = useState('');

  const close = () => {
    setMode(null);
    setValue('');
  };

  const rename = useAction(renameSpaceAction, {
    onSuccess: () => {
      close();
      toast.success(t('campaigns.folders.renameDone'));
    },
    onError: ({ error }) =>
      toast.error(t(error.serverError ?? 'campaigns.folders.renameError')),
  });

  const remove = useAction(deleteSpaceAction, {
    onSuccess: () => {
      close();
      toast.success(t('campaigns.folders.deleteDone'));
    },
    onError: ({ error }) =>
      toast.error(t(error.serverError ?? 'campaigns.folders.deleteError')),
  });

  const pending = rename.isPending || remove.isPending;

  return (
    <div className={'flex justify-end gap-1'}>
      <Button
        variant={'ghost'}
        size={'icon'}
        aria-label={t('campaigns.folders.renameButton')}
        data-test={'folder-rename-button'}
        onClick={() => {
          setValue(props.name);
          setMode('rename');
        }}
      >
        <Pencil className={'size-4'} />
      </Button>

      {props.isDefault ? null : (
        <Button
          variant={'ghost'}
          size={'icon'}
          aria-label={t('campaigns.folders.deleteButton')}
          data-test={'folder-delete-button'}
          onClick={() => setMode('delete')}
        >
          <Trash2 className={'size-4'} />
        </Button>
      )}

      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !pending) close();
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              <Trans
                i18nKey={
                  mode === 'delete'
                    ? 'campaigns.folders.deleteTitle'
                    : 'campaigns.folders.renameTitle'
                }
                values={{ name: props.name }}
              />
            </DialogTitle>

            <DialogDescription>
              <Trans
                i18nKey={
                  mode === 'delete'
                    ? 'campaigns.folders.deleteDescription'
                    : 'campaigns.folders.createDescription'
                }
                values={{ name: props.name }}
              />
            </DialogDescription>
          </DialogHeader>

          <Input
            data-test={'folder-dialog-input'}
            maxLength={100}
            value={value}
            placeholder={mode === 'delete' ? props.name : undefined}
            onChange={(event) => setValue(event.target.value)}
          />

          <DialogFooter>
            <Button variant={'outline'} disabled={pending} onClick={close}>
              <Trans i18nKey={'common.cancel'} />
            </Button>

            {mode === 'delete' ? (
              <Button
                variant={'destructive'}
                data-test={'folder-delete-confirm'}
                disabled={pending || value.trim() !== props.name.trim()}
                loading={remove.isPending}
                onClick={() =>
                  remove.execute({
                    accountId: props.accountId,
                    spaceId: props.spaceId,
                  })
                }
              >
                <Trans i18nKey={'campaigns.folders.deleteSubmit'} />
              </Button>
            ) : (
              <Button
                data-test={'folder-rename-confirm'}
                disabled={pending || value.trim().length === 0}
                loading={rename.isPending}
                onClick={() =>
                  rename.execute({
                    accountId: props.accountId,
                    spaceId: props.spaceId,
                    name: value,
                  })
                }
              >
                <Trans i18nKey={'campaigns.folders.renameSubmit'} />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
