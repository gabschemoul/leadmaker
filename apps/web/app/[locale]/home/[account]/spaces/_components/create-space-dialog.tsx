'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { PlusCircle } from 'lucide-react';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription } from '@kit/ui/alert';
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
import { useAsyncDialog } from '@kit/ui/hooks/use-async-dialog';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { Trans } from '@kit/ui/trans';

import { SpaceFormSchema } from '../_lib/schema/space.schema';
import { createSpaceAction } from '../_lib/server/server-actions';

export function CreateSpaceDialog(props: { accountId: string }) {
  const { dialogProps, isPending, setIsPending, setOpen } = useAsyncDialog();

  return (
    <>
      <Button
        size={'sm'}
        data-test={'create-folder-button'}
        onClick={() => setOpen(true)}
      >
        <PlusCircle className={'w-4'} />

        <span>
          <Trans i18nKey={'campaigns.folders.createButton'} />
        </span>
      </Button>

      <Dialog {...dialogProps}>
        <DialogContent showCloseButton={!isPending}>
          <DialogHeader>
            <DialogTitle>
              <Trans i18nKey={'campaigns.folders.createTitle'} />
            </DialogTitle>

            <DialogDescription>
              <Trans i18nKey={'campaigns.folders.createDescription'} />
            </DialogDescription>
          </DialogHeader>

          <If condition={dialogProps.open}>
            <CreateSpaceForm
              accountId={props.accountId}
              setIsPending={setIsPending}
              onClose={() => setOpen(false)}
            />
          </If>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateSpaceForm(props: {
  accountId: string;
  setIsPending: (pending: boolean) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const { execute, isPending } = useAction(createSpaceAction, {
    onExecute: () => {
      setError(null);
      props.setIsPending(true);
    },
    onSuccess: () => props.onClose(),
    onNavigation: () => props.onClose(),
    onError: ({ error }) => {
      setError(error.serverError ?? 'campaigns.folders.createError');
    },
    onSettled: () => props.setIsPending(false),
  });

  const form = useForm({
    resolver: zodResolver(SpaceFormSchema),
    defaultValues: {
      name: '',
    },
  });

  const disabled = isPending || form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        data-test={'create-folder-form'}
        className={'flex flex-col space-y-4'}
        onSubmit={form.handleSubmit((values) =>
          execute({ ...values, accountId: props.accountId }),
        )}
      >
        <If condition={error}>
          {(message) => (
            <Alert variant={'destructive'}>
              <AlertDescription>
                <Trans i18nKey={message} />
              </AlertDescription>
            </Alert>
          )}
        </If>

        <FormField
          name={'name'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'campaigns.folders.nameLabel'} />
              </FormLabel>

              <FormControl>
                <Input
                  data-test={'folder-name-input'}
                  maxLength={100}
                  {...field}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />

        <div className={'flex justify-end space-x-2'}>
          <Button
            type={'button'}
            variant={'outline'}
            disabled={disabled}
            onClick={props.onClose}
          >
            <Trans i18nKey={'common.cancel'} />
          </Button>

          <Button
            type={'submit'}
            data-test={'confirm-create-folder-button'}
            loading={disabled}
          >
            <Trans i18nKey={'campaigns.folders.createSubmit'} />
          </Button>
        </div>
      </form>
    </Form>
  );
}
