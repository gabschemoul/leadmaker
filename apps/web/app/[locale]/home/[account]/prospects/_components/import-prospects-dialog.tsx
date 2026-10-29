'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck, Upload } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { useAsyncDialog } from '@kit/ui/hooks/use-async-dialog';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';
import { Progress } from '@kit/ui/progress';
import { Trans } from '@kit/ui/trans';

import { chunkRows, parseProspectsCsv } from '~/lib/leadmaker/import-prospects';

import { ImportFormSchema } from '../_lib/schema/import.schema';
import { importProspectsAction } from '../_lib/server/server-actions';

interface ImportResult {
  inserted: number;
  duplicates: number;
  skipped: number;
}

export function ImportProspectsDialog(props: {
  /** vide quand l'organisation n'a qu'un dossier client : pas de sélecteur */
  folders: Array<{ id: string; label: string }>;
  defaultSpaceId: string;
}) {
  const { dialogProps, isPending, setIsPending, setOpen } = useAsyncDialog();

  return (
    <>
      <Button
        size={'sm'}
        variant={'outline'}
        data-test={'import-prospects-button'}
        onClick={() => setOpen(true)}
      >
        <Upload className={'w-4'} />

        <span>
          <Trans i18nKey={'campaigns.import.button'} />
        </span>
      </Button>

      <Dialog {...dialogProps}>
        <DialogContent showCloseButton={!isPending}>
          <DialogHeader>
            <DialogTitle>
              <Trans i18nKey={'campaigns.import.title'} />
            </DialogTitle>

            <DialogDescription>
              <Trans i18nKey={'campaigns.import.description'} />
            </DialogDescription>
          </DialogHeader>

          <If condition={dialogProps.open}>
            <ImportProspectsForm
              folders={props.folders}
              defaultSpaceId={props.defaultSpaceId}
              setIsPending={setIsPending}
              onClose={() => setOpen(false)}
            />
          </If>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Excel enregistre souvent en Windows-1252 : on tente l'UTF-8 d'abord. */
async function readFileText(file: File) {
  const buffer = await file.arrayBuffer();

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function ImportProspectsForm(props: {
  /** vide quand l'organisation n'a qu'un dossier client : pas de sélecteur */
  folders: Array<{ id: string; label: string }>;
  defaultSpaceId: string;
  setIsPending: (pending: boolean) => void;
  onClose: () => void;
}) {
  const locale = useLocale();

  const [state, setState] = useState<{
    error: string | null;
    result: ImportResult | null;
    progress: { done: number; total: number } | null;
  }>({ error: null, result: null, progress: null });

  const { executeAsync } = useAction(importProspectsAction, {
    onNavigation: () => props.onClose(),
  });

  const form = useForm({
    resolver: zodResolver(ImportFormSchema),
    defaultValues: {
      spaceId: props.defaultSpaceId,
      file: undefined as unknown as File,
    },
  });

  const onSubmit = async ({
    spaceId,
    file,
  }: {
    spaceId: string;
    file: File;
  }) => {
    setState({ error: null, result: null, progress: null });

    const parsed = parseProspectsCsv(await readFileText(file));

    if (!parsed.ok) {
      setState((prev) => ({
        ...prev,
        error: `campaigns.import.${parsed.error}`,
      }));

      return;
    }

    if (parsed.rows.length === 0) {
      setState((prev) => ({ ...prev, error: 'campaigns.import.noValidRows' }));

      return;
    }

    const chunks = chunkRows(parsed.rows);
    const total = { inserted: 0, duplicates: 0 };

    props.setIsPending(true);

    try {
      for (const [index, rows] of chunks.entries()) {
        setState((prev) => ({
          ...prev,
          progress: { done: index, total: chunks.length },
        }));

        const result = await executeAsync({ spaceId, rows });

        if (!result?.data) {
          setState((prev) => ({
            ...prev,
            progress: null,
            error: result?.serverError ?? 'campaigns.import.failed',
            // ce qui a déjà été importé reste importé
            result:
              index > 0 ? { ...total, skipped: parsed.skipped } : prev.result,
          }));

          return;
        }

        total.inserted += result.data.inserted;
        total.duplicates += result.data.duplicates;
      }

      setState({
        error: null,
        progress: null,
        result: { ...total, skipped: parsed.skipped },
      });
    } catch {
      setState((prev) => ({
        ...prev,
        progress: null,
        error: 'campaigns.import.failed',
      }));
    } finally {
      props.setIsPending(false);
    }
  };

  const busy = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        data-test={'import-prospects-form'}
        className={'flex flex-col space-y-4'}
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <If condition={state.result}>
          {(result) => (
            <Alert className={alertExtras.success} data-test={'import-result'}>
              <CircleCheck className={'h-4'} />

              <AlertTitle>
                <Trans
                  i18nKey={'campaigns.import.resultTitle'}
                  values={{
                    inserted: result.inserted,
                    duplicates: result.duplicates,
                  }}
                />
              </AlertTitle>

              {result.skipped > 0 ? (
                <AlertDescription>
                  <Trans
                    i18nKey={'campaigns.import.resultSkipped'}
                    values={{ count: result.skipped }}
                  />
                </AlertDescription>
              ) : null}
            </Alert>
          )}
        </If>

        <If condition={state.error}>
          {(message) => (
            <Alert variant={'destructive'}>
              <AlertDescription>
                <Trans i18nKey={message} />
              </AlertDescription>
            </Alert>
          )}
        </If>

        <If condition={props.folders.length > 1}>
          <FormField
            name={'spaceId'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'campaigns.import.folderLabel'} />
                </FormLabel>

                <FormControl>
                  <NativeSelect
                    className={'w-full'}
                    data-test={'import-folder-select'}
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                  >
                    {props.folders.map((folder) => (
                      <NativeSelectOption key={folder.id} value={folder.id}>
                        {folder.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />
        </If>

        <FormField
          name={'file'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'campaigns.import.fileLabel'} />
              </FormLabel>

              <FormControl>
                <Input
                  type={'file'}
                  accept={'.csv,text/csv'}
                  data-test={'import-file-input'}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    setState({ error: null, result: null, progress: null });
                    field.onChange(event.target.files?.[0]);
                  }}
                />
              </FormControl>

              <FormDescription>
                <Trans i18nKey={'campaigns.import.fileHint'} />
              </FormDescription>

              <FormMessage />
            </FormItem>
          )}
        />

        <If condition={state.progress}>
          {(progress) => (
            <div className={'flex flex-col gap-2 text-sm'}>
              <Trans
                i18nKey={'campaigns.import.progress'}
                values={{ done: progress.done + 1, total: progress.total }}
              />

              <Progress
                locale={locale}
                value={(progress.done / progress.total) * 100}
              />
            </div>
          )}
        </If>

        <div className={'flex justify-end space-x-2'}>
          <Button
            type={'button'}
            variant={'outline'}
            disabled={busy}
            onClick={props.onClose}
          >
            <Trans
              i18nKey={
                state.result ? 'campaigns.import.close' : 'common.cancel'
              }
            />
          </Button>

          <Button
            type={'submit'}
            data-test={'confirm-import-button'}
            disabled={busy}
          >
            <Trans
              i18nKey={
                busy ? 'campaigns.import.importing' : 'campaigns.import.submit'
              }
            />
          </Button>
        </div>
      </form>
    </Form>
  );
}
