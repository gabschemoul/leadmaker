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

import type { CountryOption } from '~/lib/leadmaker/countries';

import { CountrySelect } from '../../_components/leadmaker/country-select';
import { SpaceFormSchema } from '../_lib/schema/space.schema';
import { createSpaceAction } from '../_lib/server/server-actions';

export function CreateSpaceDialog(props: {
  accountId: string;
  countries: CountryOption[];
}) {
  const { dialogProps, isPending, setIsPending, setOpen } = useAsyncDialog();

  return (
    <>
      <Button
        size={'sm'}
        data-test={'create-space-button'}
        onClick={() => setOpen(true)}
      >
        <PlusCircle className={'w-4'} />

        <span>
          <Trans i18nKey={'campaigns.spaces.createButton'} />
        </span>
      </Button>

      <Dialog {...dialogProps}>
        <DialogContent showCloseButton={!isPending}>
          <DialogHeader>
            <DialogTitle>
              <Trans i18nKey={'campaigns.spaces.createTitle'} />
            </DialogTitle>

            <DialogDescription>
              <Trans i18nKey={'campaigns.spaces.createDescription'} />
            </DialogDescription>
          </DialogHeader>

          <If condition={dialogProps.open}>
            <CreateSpaceForm
              accountId={props.accountId}
              countries={props.countries}
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
  countries: CountryOption[];
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
      setError(error.serverError ?? 'campaigns.spaces.createError');
    },
    onSettled: () => props.setIsPending(false),
  });

  const form = useForm({
    resolver: zodResolver(SpaceFormSchema),
    defaultValues: {
      name: '',
      countryCode: props.countries[0]?.code ?? 'FR',
    },
  });

  const disabled = isPending || form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        data-test={'create-space-form'}
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
                <Trans i18nKey={'campaigns.spaces.nameLabel'} />
              </FormLabel>

              <FormControl>
                <Input
                  data-test={'space-name-input'}
                  maxLength={100}
                  {...field}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name={'countryCode'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'campaigns.spaces.countryLabel'} />
              </FormLabel>

              <FormControl>
                <CountrySelect
                  data-test={'space-country-select'}
                  countries={props.countries}
                  value={field.value}
                  onChange={field.onChange}
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
            data-test={'confirm-create-space-button'}
            disabled={disabled}
          >
            <Trans i18nKey={'campaigns.spaces.createSubmit'} />
          </Button>
        </div>
      </form>
    </Form>
  );
}
