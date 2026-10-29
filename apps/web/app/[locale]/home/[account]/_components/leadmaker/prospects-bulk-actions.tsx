'use client';

import { useState } from 'react';

import { Ban, Download, RotateCcw, Trash2, X } from 'lucide-react';
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

import {
  deleteProspectsAction,
  excludeProspectsAction,
  restoreProspectsAction,
} from '../../prospects/_lib/server/server-actions';

type BulkOperation = 'exclude' | 'restore' | 'delete';

/**
 * Barre affichée dès qu'au moins une ligne est cochée : export, exclusion,
 * rétablissement et suppression (avec confirmation) de la sélection.
 */
export function ProspectsBulkActions(props: {
  accountId: string;
  selected: Array<{ id: string; excluded_at: string | null }>;
  canDelete: boolean;
  onClear: () => void;
  /** appelé après une action réussie (le parent rafraîchit ses données) */
  onMutated?: () => void;
}) {
  const t = useTranslations('prospects');
  const [pending, setPending] = useState<BulkOperation | null>(null);

  const ids = props.selected.map((prospect) => prospect.id);
  const hasActive = props.selected.some((prospect) => !prospect.excluded_at);
  const hasExcluded = props.selected.some((prospect) => prospect.excluded_at);
  const exportHref = `/api/leadmaker/export?ids=${ids.join(',')}`;

  const close = () => setPending(null);

  const callbacks = (operation: BulkOperation) => ({
    onSuccess: ({ data }: { data?: { count: number } }) => {
      if (data && data.count > 0) {
        toast.success(t(`actions.${operation}Done`, { count: data.count }));
      } else {
        toast.info(t('actions.nothingDone'));
      }

      close();
      props.onClear();
      props.onMutated?.();
    },
    onError: ({ error }: { error: { serverError?: string } }) => {
      toast.error(t(error.serverError ?? `actions.${operation}Failed`));
    },
    // la route reste montée après une redirection (session expirée) :
    // on ferme le dialogue soi-même
    onNavigation: close,
  });

  const actions = {
    exclude: useAction(excludeProspectsAction, callbacks('exclude')),
    restore: useAction(restoreProspectsAction, callbacks('restore')),
    delete: useAction(deleteProspectsAction, callbacks('delete')),
  };

  const isPending =
    actions.exclude.isPending ||
    actions.restore.isPending ||
    actions.delete.isPending;

  const confirm = () => {
    if (pending) {
      actions[pending].execute({ accountId: props.accountId, ids });
    }
  };

  return (
    <div
      className={
        'bg-muted/60 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm'
      }
      data-test={'prospects-bulk-actions'}
    >
      <span className={'font-medium'} data-test={'prospects-selected-count'}>
        <Trans
          i18nKey={'prospects.selection.count'}
          values={{ count: ids.length }}
        />
      </span>

      <div className={'flex flex-wrap items-center gap-2'}>
        <Button
          size={'sm'}
          variant={'outline'}
          nativeButton={false}
          data-test={'prospects-export-selection'}
          render={<a href={exportHref} download />}
        >
          <Download className={'w-4'} />

          <span>
            <Trans i18nKey={'prospects.selection.export'} />
          </span>
        </Button>

        {hasActive ? (
          <Button
            size={'sm'}
            variant={'outline'}
            data-test={'prospects-exclude-button'}
            onClick={() => setPending('exclude')}
          >
            <Ban className={'w-4'} />

            <span>
              <Trans i18nKey={'prospects.selection.exclude'} />
            </span>
          </Button>
        ) : null}

        {hasExcluded ? (
          <Button
            size={'sm'}
            variant={'outline'}
            data-test={'prospects-restore-button'}
            onClick={() => setPending('restore')}
          >
            <RotateCcw className={'w-4'} />

            <span>
              <Trans i18nKey={'prospects.selection.restore'} />
            </span>
          </Button>
        ) : null}

        {props.canDelete ? (
          <Button
            size={'sm'}
            variant={'destructive'}
            data-test={'prospects-delete-button'}
            onClick={() => setPending('delete')}
          >
            <Trash2 className={'w-4'} />

            <span>
              <Trans i18nKey={'prospects.selection.delete'} />
            </span>
          </Button>
        ) : null}
      </div>

      <Button
        size={'sm'}
        variant={'ghost'}
        className={'ml-auto'}
        data-test={'prospects-clear-selection'}
        onClick={props.onClear}
      >
        <X className={'w-4'} />

        <span>
          <Trans i18nKey={'prospects.selection.clear'} />
        </span>
      </Button>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) close();
        }}
      >
        <AlertDialogContent data-test={'prospects-confirm-dialog'}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans
                i18nKey={`prospects.confirm.${pending ?? 'exclude'}Title`}
                values={{ count: ids.length }}
              />
            </AlertDialogTitle>

            <AlertDialogDescription>
              <Trans
                i18nKey={`prospects.confirm.${pending ?? 'exclude'}Description`}
                values={{ count: ids.length }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              <Trans i18nKey={'common.cancel'} />
            </AlertDialogCancel>

            <Button
              variant={pending === 'delete' ? 'destructive' : 'default'}
              disabled={isPending}
              data-test={'prospects-confirm-button'}
              onClick={confirm}
            >
              <Trans
                i18nKey={
                  isPending
                    ? 'prospects.confirm.working'
                    : `prospects.confirm.${pending ?? 'exclude'}Submit`
                }
              />
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
