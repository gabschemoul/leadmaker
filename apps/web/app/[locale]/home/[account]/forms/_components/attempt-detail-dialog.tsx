'use client';

/**
 * Rôle : vue unitaire d'un formulaire préparé (mode avancé) : capture, champs, message modifiable, validation.
 * Données : AttemptRow (forms.loader) passé par le tableau.
 * Écritures : updateAttemptAction (lm_update_attempt, puis validation) et markAttemptsAction (« à vérifier »).
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { Trans } from '@kit/ui/trans';

import {
  extraValues,
  filledEntries,
  missingLabels,
} from '~/lib/leadmaker/attempts';
import { websiteHref } from '~/lib/leadmaker/website';

import { AttemptEditFormSchema } from '../_lib/schema/forms-actions.schema';
import type { AttemptRow } from '../_lib/server/forms.loader';
import {
  markAttemptsAction,
  updateAttemptAction,
} from '../_lib/server/server-actions';

const EDITABLE = new Set(['ready', 'incomplete']);

/**
 * Vue unitaire d'un formulaire : capture, message modifiable, champs remplis,
 * champs manquants à renseigner, validation.
 */
export function AttemptDetailDialog(props: {
  attempt: AttemptRow | null;
  accountId: string;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
}) {
  const attempt = props.attempt;

  return (
    <Dialog open={attempt !== null} onOpenChange={props.onOpenChange}>
      <DialogContent
        className={'max-h-[90vh] overflow-y-auto sm:max-w-3xl'}
        data-test={'attempt-detail-dialog'}
      >
        {attempt ? (
          <AttemptDetail
            key={attempt.id}
            attempt={attempt}
            accountId={props.accountId}
            onClose={() => props.onOpenChange(false)}
            onMutated={props.onMutated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AttemptDetail(props: {
  attempt: AttemptRow;
  accountId: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const t = useTranslations('outreach.forms');
  const { attempt } = props;
  const editable = EDITABLE.has(attempt.status);
  const missing = missingLabels(attempt.missing);
  const extra = extraValues(attempt.extra);
  const siteUrl = attempt.form_url ?? attempt.prospect.website;
  const siteHref = websiteHref(siteUrl);

  const { execute, isPending } = useAction(updateAttemptAction, {
    onSuccess: ({ data }) => {
      toast.success(
        data?.validated
          ? t('actions.validateDone', { count: data.validated })
          : t('actions.updated'),
      );
      props.onMutated();
      props.onClose();
    },
    onNavigation: props.onClose,
    onError: ({ error }) =>
      toast.error(
        t(
          (error.serverError ?? 'outreach.forms.actions.updateFailed').replace(
            'outreach.forms.',
            '',
          ),
        ),
      ),
  });

  const mark = useAction(markAttemptsAction, {
    onSuccess: ({ data }) => {
      toast.success(t('actions.markDone', { count: data?.count ?? 0 }));
      props.onMutated();
      props.onClose();
    },
    onNavigation: props.onClose,
    onError: () => toast.error(t('actions.failed')),
  });

  const form = useForm({
    resolver: zodResolver(AttemptEditFormSchema),
    defaultValues: {
      subject: attempt.subject ?? '',
      body: attempt.body ?? '',
      extraValues: missing.map((label) => ({
        label,
        value: extra[label] ?? '',
      })),
    },
  });

  const disabled = !editable || isPending || form.formState.isSubmitting;

  const submit = (validate: boolean) =>
    form.handleSubmit((values) =>
      execute({
        ...values,
        accountId: props.accountId,
        id: attempt.id,
        validate,
      }),
    )();

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t('detail.title', { name: attempt.prospect.name })}
        </DialogTitle>

        <DialogDescription className={'flex flex-wrap gap-x-4 gap-y-1'}>
          <span>
            <Trans i18nKey={`outreach.forms.status.${attempt.status}`} />
          </span>

          {attempt.template_used ? (
            <span>
              {t('detail.template')} {attempt.template_used}
            </span>
          ) : null}

          {attempt.protection_type ? (
            <span>
              {t('detail.protection')}{' '}
              {t(`protection.${attempt.protection_type}` as never) ||
                attempt.protection_type}
            </span>
          ) : null}

          {siteUrl && siteHref ? (
            <a
              className={'inline-flex items-center gap-1 underline'}
              href={siteHref}
              target={'_blank'}
              rel={'noreferrer'}
            >
              {attempt.form_url ? t('openForm') : t('openSite')}
              <ExternalLink className={'h-3 w-3'} />
            </a>
          ) : siteUrl ? (
            // adresse qui n'est pas une URL http(s) : affichée, jamais cliquable
            <span className={'break-all'}>{siteUrl}</span>
          ) : null}
        </DialogDescription>
      </DialogHeader>

      {attempt.detail ? (
        <p
          className={'bg-muted rounded-md px-3 py-2 text-sm'}
          data-test={'attempt-detail-text'}
        >
          {attempt.detail}
        </p>
      ) : null}

      {attempt.screenshotAfterUrl ? (
        <figure className={'flex flex-col gap-1'}>
          <figcaption className={'text-muted-foreground text-xs'}>
            {t('detail.screenshotAfter')}
          </figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attempt.screenshotAfterUrl}
            alt={t('detail.screenshotAfter')}
            className={
              'max-h-96 w-full rounded-md border object-contain object-top'
            }
            data-test={'attempt-screenshot-after'}
          />
        </figure>
      ) : null}

      {attempt.status === 'to_verify' ? (
        <div
          className={'flex flex-wrap gap-2'}
          data-test={'attempt-verify-actions'}
        >
          <Button
            type={'button'}
            disabled={mark.isPending}
            data-test={'attempt-mark-sent'}
            onClick={() =>
              mark.execute({
                accountId: props.accountId,
                ids: [attempt.id],
                outcome: 'sent',
              })
            }
          >
            {t('selection.markSent')}
          </Button>

          <Button
            type={'button'}
            variant={'outline'}
            disabled={mark.isPending}
            data-test={'attempt-mark-failed'}
            onClick={() =>
              mark.execute({
                accountId: props.accountId,
                ids: [attempt.id],
                outcome: 'failed',
              })
            }
          >
            {t('selection.markFailed')}
          </Button>
        </div>
      ) : null}

      {attempt.screenshotUrl ? (
        <figure className={'flex flex-col gap-1'}>
          <figcaption className={'text-muted-foreground text-xs'}>
            {t('detail.screenshot')}
          </figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attempt.screenshotUrl}
            alt={t('detail.screenshot')}
            className={
              'max-h-96 w-full rounded-md border object-contain object-top'
            }
            data-test={'attempt-screenshot'}
          />
        </figure>
      ) : null}

      <Form {...form}>
        <form
          className={'flex flex-col gap-4'}
          onSubmit={(event) => event.preventDefault()}
        >
          <FormField
            name={'subject'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('detail.subject')}</FormLabel>
                <FormControl>
                  <Input
                    data-test={'attempt-subject'}
                    maxLength={200}
                    disabled={!editable}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            name={'body'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('detail.body')}</FormLabel>
                <FormControl>
                  <Textarea
                    data-test={'attempt-body'}
                    className={'min-h-40'}
                    maxLength={5000}
                    disabled={!editable}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {missing.length > 0 ? (
            <fieldset className={'flex flex-col gap-3 rounded-md border p-3'}>
              <legend className={'px-1 text-sm font-medium'}>
                {t('detail.missing')}
              </legend>

              <p className={'text-muted-foreground text-xs'}>
                {t('detail.missingHint')}
              </p>

              {missing.map((label, index) => (
                <FormField
                  key={label}
                  name={`extraValues.${index}.value`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input
                          data-test={`attempt-extra-${index}`}
                          maxLength={500}
                          disabled={!editable}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </fieldset>
          ) : null}

          {filledEntries(attempt.filled).length > 0 ? (
            <div className={'flex flex-col gap-1'}>
              <span className={'text-sm font-medium'}>
                {t('detail.filled')}
              </span>

              <ul
                className={
                  'text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'
                }
              >
                {filledEntries(attempt.filled).map(([kind, label]) => (
                  <li key={kind}>{label}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={'flex flex-wrap justify-end gap-2'}>
            <Button
              type={'button'}
              variant={'outline'}
              onClick={props.onClose}
              disabled={isPending}
            >
              {t('detail.close')}
            </Button>

            {editable ? (
              <>
                <Button
                  type={'button'}
                  variant={'secondary'}
                  data-test={'attempt-save'}
                  disabled={disabled}
                  onClick={() => submit(false)}
                >
                  {t('detail.save')}
                </Button>

                <Button
                  type={'button'}
                  data-test={'attempt-save-validate'}
                  disabled={disabled}
                  onClick={() => submit(true)}
                >
                  {t('detail.saveAndValidate')}
                </Button>
              </>
            ) : null}
          </div>
        </form>
      </Form>
    </>
  );
}
