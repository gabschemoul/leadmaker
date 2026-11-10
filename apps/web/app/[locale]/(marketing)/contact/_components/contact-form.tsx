'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { Trans } from '@kit/ui/trans';

import { ContactEmailSchema } from '~/(marketing)/contact/_lib/contact-email.schema';
import { sendContactEmail } from '~/(marketing)/contact/_lib/server/server-actions';

export function ContactForm() {
  const [state, setState] = useState({
    success: false,
    error: false,
  });

  const { execute, isPending } = useAction(sendContactEmail, {
    onSuccess: () => {
      setState({ success: true, error: false });
    },
    onError: () => {
      setState({ error: true, success: false });
    },
  });

  const form = useForm({
    resolver: zodResolver(ContactEmailSchema),
    defaultValues: {
      name: '',
      email: '',
      message: '',
      website: '',
    },
  });

  if (state.success) {
    return <SuccessAlert />;
  }

  if (state.error) {
    return <ErrorAlert />;
  }

  return (
    <Form {...form}>
      <form
        className={'flex flex-col space-y-4'}
        onSubmit={form.handleSubmit(execute)}
      >
        {/* Piège à robots : hors écran, ignoré par les lecteurs d'écran et le remplissage automatique */}
        <input
          type={'text'}
          tabIndex={-1}
          autoComplete={'off'}
          aria-hidden={'true'}
          className={'absolute -left-[9999px] h-0 w-0 opacity-0'}
          {...form.register('website')}
        />

        <FormField
          name={'name'}
          render={({ field }) => {
            return (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'marketing.contactName'} />
                </FormLabel>

                <FormControl>
                  <Input maxLength={200} {...field} />
                </FormControl>

                <FormMessage />
              </FormItem>
            );
          }}
        />

        <FormField
          name={'email'}
          render={({ field }) => {
            return (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'marketing.contactEmail'} />
                </FormLabel>

                <FormControl>
                  <Input type={'email'} {...field} />
                </FormControl>

                <FormMessage />
              </FormItem>
            );
          }}
        />

        <FormField
          name={'message'}
          render={({ field }) => {
            return (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'marketing.contactMessage'} />
                </FormLabel>

                <FormControl>
                  <Textarea
                    className={'min-h-36'}
                    maxLength={5000}
                    {...field}
                  />
                </FormControl>

                <FormMessage />
              </FormItem>
            );
          }}
        />

        <Button
          loading={isPending}
          type={'submit'}
          size="lg"
          className={
            'bg-brand text-brand-foreground hover:bg-brand-hover h-11 self-start rounded-full px-5 text-[0.9375rem] font-normal'
          }
        >
          <Trans i18nKey={'marketing.sendMessage'} />
        </Button>
      </form>
    </Form>
  );
}

function SuccessAlert() {
  return (
    <Alert className={alertExtras.success}>
      <AlertTitle>
        <Trans i18nKey={'marketing.contactSuccess'} />
      </AlertTitle>

      <AlertDescription>
        <Trans i18nKey={'marketing.contactSuccessDescription'} />
      </AlertDescription>
    </Alert>
  );
}

function ErrorAlert() {
  return (
    <Alert variant={'destructive'}>
      <AlertTitle>
        <Trans i18nKey={'marketing.contactError'} />
      </AlertTitle>

      <AlertDescription>
        <Trans i18nKey={'marketing.contactErrorDescription'} />
      </AlertDescription>
    </Alert>
  );
}
