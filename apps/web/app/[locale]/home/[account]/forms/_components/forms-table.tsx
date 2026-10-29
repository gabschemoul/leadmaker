'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import {
  Ban,
  Check,
  ExternalLink,
  SkipForward,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
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
import { badgeExtras } from '@kit/ui/badge-extras';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import { toast } from '@kit/ui/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import {
  type AttemptGroup,
  hasAlert,
  missingLabels,
} from '~/lib/leadmaker/attempts';

import type { AttemptRow } from '../_lib/server/forms.loader';
import {
  excludeAttemptsAction,
  markAttemptsAction,
  skipAttemptsAction,
  validateAttemptsAction,
} from '../_lib/server/server-actions';
import { AttemptDetailDialog } from './attempt-detail-dialog';
import { FormsLiveRefresh } from './forms-live-refresh';

type BulkOperation =
  | 'validate'
  | 'skip'
  | 'exclude'
  | 'markSent'
  | 'markFailed';

const STATUS_STYLE: Record<string, string> = {
  ready: badgeExtras.success,
  validated: badgeExtras.success,
  sent: badgeExtras.success,
  incomplete: badgeExtras.warning,
  intervention_required: badgeExtras.warning,
  to_verify: badgeExtras.warning,
  pending: badgeExtras.info,
  preparing: badgeExtras.info,
  sending: badgeExtras.info,
};

function websiteLabel(website: string) {
  return website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '');
}

/**
 * Tableau des formulaires d'un groupe : cases à cocher, sélection « sans
 * alerte », actions groupées (valider, passer, exclure) et vue unitaire.
 */
export function FormsTable(props: {
  rows: AttemptRow[];
  group: AttemptGroup;
  accountId: string;
  spaceId: string;
  preparing: number;
}) {
  const t = useTranslations('outreach.forms');
  const format = useFormatter();
  const router = useRouter();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<BulkOperation | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const actionable = props.group === 'ready' || props.group === 'incomplete';
  const canValidate = actionable;
  const canSkip = [
    'ready',
    'incomplete',
    'intervention_required',
    'no_form',
    'unreachable',
    'preparing',
  ].includes(props.group);
  const canExclude = !['sent', 'excluded', 'to_verify'].includes(props.group);
  const canMark = props.group === 'to_verify';

  const ids = [...selection].filter((id) =>
    props.rows.some((row) => row.id === id),
  );
  const refresh = () => router.refresh();
  const clear = () => setSelection(new Set());
  const close = () => setPending(null);

  const callbacks = (operation: BulkOperation) => ({
    onSuccess: ({ data }: { data?: { count: number } }) => {
      const count = data?.count ?? 0;
      toast[count > 0 ? 'success' : 'info'](
        t(`actions.${operation}Done`, { count }),
      );

      if (operation === 'validate' && count < ids.length) {
        toast.warning(t('actions.validateIncomplete'));
      }

      close();
      clear();
      refresh();
    },
    onError: ({ error }: { error: { serverError?: string } }) => {
      toast.error(
        t(
          (error.serverError ?? 'outreach.forms.actions.failed').replace(
            'outreach.forms.',
            '',
          ),
        ),
      );
    },
    onNavigation: close,
  });

  const actions = {
    validate: useAction(validateAttemptsAction, callbacks('validate')),
    skip: useAction(skipAttemptsAction, callbacks('skip')),
    exclude: useAction(excludeAttemptsAction, callbacks('exclude')),
    markSent: useAction(markAttemptsAction, callbacks('markSent')),
    markFailed: useAction(markAttemptsAction, callbacks('markFailed')),
  };

  const isPending = Object.values(actions).some((action) => action.isPending);

  const run = (operation: BulkOperation) => {
    const input = { accountId: props.accountId, ids };

    if (operation === 'markSent') {
      actions.markSent.execute({ ...input, outcome: 'sent' });
    } else if (operation === 'markFailed') {
      actions.markFailed.execute({ ...input, outcome: 'failed' });
    } else {
      actions[operation].execute(input);
    }
  };

  const toggle = (id: string, checked: boolean) =>
    setSelection((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const selectAll = () =>
    setSelection(new Set(props.rows.map((row) => row.id)));
  const selectClean = () =>
    setSelection(
      new Set(props.rows.filter((row) => !hasAlert(row)).map((row) => row.id)),
    );

  const open = props.rows.find((row) => row.id === openId) ?? null;

  return (
    <div className={'flex flex-col gap-3'}>
      <FormsLiveRefresh
        spaceId={props.spaceId}
        preparing={props.preparing}
        paused={isPending || pending !== null || openId !== null}
      />

      <div className={'flex flex-wrap items-center gap-2 text-sm'}>
        <Button
          size={'sm'}
          variant={'outline'}
          data-test={'forms-select-all'}
          onClick={selectAll}
          disabled={props.rows.length === 0}
        >
          {t('selection.all')}
        </Button>

        {actionable ? (
          <Button
            size={'sm'}
            variant={'outline'}
            data-test={'forms-select-clean'}
            onClick={selectClean}
            disabled={props.rows.length === 0}
          >
            {t('selection.clean')}
          </Button>
        ) : null}

        {ids.length > 0 ? (
          <>
            <Button
              size={'sm'}
              variant={'ghost'}
              data-test={'forms-select-none'}
              onClick={clear}
            >
              <X className={'w-4'} />
              {t('selection.none')}
            </Button>

            <span className={'font-medium'} data-test={'forms-selected-count'}>
              {t('selection.count', { count: ids.length })}
            </span>

            {canValidate ? (
              <Button
                size={'sm'}
                data-test={'forms-validate-button'}
                onClick={() => setPending('validate')}
              >
                <Check className={'w-4'} />
                {t('selection.validate')}
              </Button>
            ) : null}

            {canSkip ? (
              <Button
                size={'sm'}
                variant={'outline'}
                data-test={'forms-skip-button'}
                onClick={() => setPending('skip')}
              >
                <SkipForward className={'w-4'} />
                {t('selection.skip')}
              </Button>
            ) : null}

            {canMark ? (
              <>
                <Button
                  size={'sm'}
                  data-test={'forms-mark-sent-button'}
                  onClick={() => setPending('markSent')}
                >
                  <ThumbsUp className={'w-4'} />
                  {t('selection.markSent')}
                </Button>

                <Button
                  size={'sm'}
                  variant={'outline'}
                  data-test={'forms-mark-failed-button'}
                  onClick={() => setPending('markFailed')}
                >
                  <ThumbsDown className={'w-4'} />
                  {t('selection.markFailed')}
                </Button>
              </>
            ) : null}

            {canExclude ? (
              <Button
                size={'sm'}
                variant={'outline'}
                data-test={'forms-exclude-button'}
                onClick={() => setPending('exclude')}
              >
                <Ban className={'w-4'} />
                {t('selection.exclude')}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      <Table data-test={'forms-table'}>
        <TableHeader>
          <TableRow>
            <TableHead className={'w-8'} />
            <TableHead>{t('columns.company')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            <TableHead>{t('columns.message')}</TableHead>
            <TableHead>{t('columns.detail')}</TableHead>
            <TableHead>{t('columns.screenshot')}</TableHead>
            <TableHead>{t('columns.preparedAt')}</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {props.rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className={'text-muted-foreground py-8 text-center'}
                data-test={'forms-empty'}
              >
                <p>{t('empty')}</p>
                <p className={'text-xs'}>{t('emptyHint')}</p>
              </TableCell>
            </TableRow>
          ) : null}

          {props.rows.map((row) => {
            const alert = hasAlert(row);
            const missing = missingLabels(row.missing);

            return (
              <TableRow
                key={row.id}
                data-test={'forms-row'}
                className={cn(
                  'cursor-pointer',
                  selection.has(row.id) && 'bg-muted/40',
                )}
                onClick={() => setOpenId(row.id)}
              >
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={selection.has(row.id)}
                    onCheckedChange={(checked) =>
                      toggle(row.id, checked === true)
                    }
                    aria-label={row.prospect.name}
                    data-test={'forms-row-checkbox'}
                  />
                </TableCell>

                <TableCell className={'max-w-72'}>
                  <div className={'flex flex-col'}>
                    <span className={'truncate font-medium'}>
                      {row.prospect.name}
                    </span>

                    {row.prospect.website ? (
                      <a
                        className={
                          'text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline'
                        }
                        href={row.form_url ?? row.prospect.website}
                        target={'_blank'}
                        rel={'noreferrer'}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {websiteLabel(row.prospect.website)}
                        <ExternalLink className={'h-3 w-3'} />
                      </a>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell>
                  <Badge
                    variant={'outline'}
                    className={cn(STATUS_STYLE[row.status])}
                  >
                    <Trans i18nKey={`outreach.forms.status.${row.status}`} />
                  </Badge>
                </TableCell>

                <TableCell className={'text-sm'}>
                  {row.template_used ?? '–'}
                </TableCell>

                <TableCell className={'max-w-80 text-xs'}>
                  <div className={'flex flex-col gap-1'}>
                    {missing.length > 0 ? (
                      <Badge
                        variant={'outline'}
                        className={cn('w-fit', badgeExtras.warning)}
                      >
                        {t('missingBadge', { count: missing.length })}
                      </Badge>
                    ) : null}

                    {row.protection_type ? (
                      <Badge
                        variant={'outline'}
                        className={cn('w-fit', badgeExtras.warning)}
                      >
                        {t(`protection.${row.protection_type}` as never) ||
                          row.protection_type}
                      </Badge>
                    ) : null}

                    {row.detail ? (
                      <span className={'text-muted-foreground line-clamp-2'}>
                        {alert &&
                        missing.length === 0 &&
                        !row.protection_type ? (
                          <TriangleAlert className={'mr-1 inline h-3 w-3'} />
                        ) : null}
                        {row.detail}
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell>
                  {(row.screenshotAfterUrl ?? row.screenshotUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.screenshotAfterUrl ?? row.screenshotUrl ?? ''}
                      alt={''}
                      className={
                        'h-12 w-20 rounded border object-cover object-top'
                      }
                      loading={'lazy'}
                    />
                  ) : (
                    <span className={'text-muted-foreground text-xs'}>
                      {t('noScreenshot')}
                    </span>
                  )}
                </TableCell>

                <TableCell
                  className={'text-muted-foreground text-xs tabular-nums'}
                >
                  {format.dateTime(new Date(row.updated_at), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AttemptDetailDialog
        attempt={open}
        accountId={props.accountId}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpenId(null);
        }}
        onMutated={refresh}
      />

      <AlertDialog
        open={pending !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isPending) close();
        }}
      >
        <AlertDialogContent data-test={'forms-confirm-dialog'}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`confirm.${pending ?? 'validate'}Title`, {
                count: ids.length,
              })}
            </AlertDialogTitle>

            <AlertDialogDescription>
              {t(`confirm.${pending ?? 'validate'}Description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              <Trans i18nKey={'common.cancel'} />
            </AlertDialogCancel>

            <Button
              variant={pending === 'exclude' ? 'destructive' : 'default'}
              disabled={isPending}
              data-test={'forms-confirm-button'}
              onClick={() => {
                if (pending) run(pending);
              }}
            >
              {isPending
                ? t('confirm.working')
                : t(`confirm.${pending ?? 'validate'}Submit`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
