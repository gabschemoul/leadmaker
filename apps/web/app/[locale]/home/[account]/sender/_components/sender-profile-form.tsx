'use client';

/**
 * Rôle : formulaire d'un expéditeur (identité et coordonnées utilisées dans les formulaires de contact).
 * Données : valeurs initiales passées par la page Expéditeurs.
 * Écritures : saveSenderProfileAction (lm_sender_profiles).
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import type { CountryOption } from '~/lib/leadmaker/countries';

import {
  CIVILITIES,
  SenderProfileFormSchema,
  type SenderProfileFormValues,
} from '../_lib/schema/sender-profile.schema';
import { saveSenderProfileAction } from '../_lib/server/server-actions';

const CIVILITY_LABELS = {
  '': 'outreach.sender.civilityNone',
  mrs: 'outreach.sender.civilityMrs',
  mr: 'outreach.sender.civilityMr',
} as const;

export function SenderProfileForm(props: {
  accountId: string;
  accountSlug: string;
  spaceId: string;
  /** expéditeur modifié ; absent = nouvel expéditeur */
  senderId?: string;
  countries: CountryOption[];
  defaultValues: SenderProfileFormValues;
}) {
  const t = useTranslations();

  const { execute, isPending } = useAction(saveSenderProfileAction, {
    onSuccess: () => toast.success(t('outreach.sender.saved')),
    // nouvel expéditeur : l'action renvoie vers sa page
    onNavigation: () => toast.success(t('outreach.sender.created')),
    onError: ({ error }) =>
      toast.error(t(error.serverError ?? 'outreach.sender.saveFailed')),
  });

  const form = useForm({
    resolver: zodResolver(SenderProfileFormSchema),
    defaultValues: props.defaultValues,
  });

  const disabled = isPending || form.formState.isSubmitting;

  const text = (
    name: keyof SenderProfileFormValues,
    labelKey: string,
    options: {
      hint?: string;
      maxLength?: number;
      type?: string;
      autoComplete?: string;
    } = {},
  ) => (
    <FormField
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            <Trans i18nKey={labelKey} />
          </FormLabel>

          <FormControl>
            <Input
              data-test={`sender-${name}-input`}
              type={options.type ?? 'text'}
              maxLength={options.maxLength ?? 255}
              autoComplete={options.autoComplete}
              {...field}
            />
          </FormControl>

          {options.hint ? (
            <FormDescription>
              <Trans i18nKey={options.hint} />
            </FormDescription>
          ) : null}

          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form
        data-test={'sender-profile-form'}
        className={'flex flex-col gap-8'}
        onSubmit={form.handleSubmit((values) =>
          execute({
            ...values,
            accountId: props.accountId,
            accountSlug: props.accountSlug,
            spaceId: props.spaceId,
            senderId: props.senderId,
          }),
        )}
      >
        <Section titleKey={'outreach.sender.identitySection'}>
          <FormField
            name={'civility'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'outreach.sender.civility'} />
                </FormLabel>

                <FormControl>
                  <NativeSelect
                    className={'w-full'}
                    data-test={'sender-civility-select'}
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                  >
                    {CIVILITIES.map((civility) => (
                      <NativeSelectOption key={civility} value={civility}>
                        {t(CIVILITY_LABELS[civility])}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />

          {text('firstName', 'outreach.sender.firstName', {
            maxLength: 100,
            autoComplete: 'given-name',
          })}

          {text('lastName', 'outreach.sender.lastName', {
            maxLength: 100,
            autoComplete: 'family-name',
          })}

          {text('company', 'outreach.sender.company', {
            autoComplete: 'organization',
          })}

          {text('jobTitle', 'outreach.sender.jobTitle', {
            maxLength: 150,
            hint: 'outreach.sender.jobTitleHint',
            autoComplete: 'organization-title',
          })}
        </Section>

        <Section titleKey={'outreach.sender.contactSection'}>
          {text('email', 'outreach.sender.email', {
            type: 'email',
            maxLength: 320,
            hint: 'outreach.sender.emailHint',
            autoComplete: 'email',
          })}

          {text('phone', 'outreach.sender.phone', {
            type: 'tel',
            maxLength: 50,
            autoComplete: 'tel',
          })}

          {text('website', 'outreach.sender.website', {
            maxLength: 500,
            autoComplete: 'url',
          })}
        </Section>

        <Section titleKey={'outreach.sender.addressSection'}>
          {text('address', 'outreach.sender.address', {
            maxLength: 500,
            autoComplete: 'street-address',
          })}

          {text('zip', 'outreach.sender.zip', {
            maxLength: 20,
            autoComplete: 'postal-code',
          })}

          {text('city', 'outreach.sender.city', {
            maxLength: 150,
            autoComplete: 'address-level2',
          })}

          <FormField
            name={'countryCode'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans i18nKey={'outreach.sender.country'} />
                </FormLabel>

                <FormControl>
                  <NativeSelect
                    className={'w-full'}
                    data-test={'sender-country-select'}
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                  >
                    <NativeSelectOption value={''}>
                      {t('outreach.sender.countryPlaceholder')}
                    </NativeSelectOption>

                    {props.countries.map((country) => (
                      <NativeSelectOption
                        key={country.code}
                        value={country.code}
                      >
                        {country.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />
        </Section>

        <div className={'flex justify-end'}>
          <Button
            type={'submit'}
            data-test={'sender-save-button'}
            disabled={disabled}
          >
            <Trans
              i18nKey={
                props.senderId
                  ? 'outreach.sender.save'
                  : 'outreach.sender.create'
              }
            />
          </Button>
        </div>
      </form>
    </Form>
  );
}

function Section(props: React.PropsWithChildren<{ titleKey: string }>) {
  return (
    <fieldset className={'flex flex-col gap-4'}>
      <legend className={'mb-4 text-sm font-medium'}>
        <Trans i18nKey={props.titleKey} />
      </legend>

      <div className={'grid gap-4 md:grid-cols-2'}>{props.children}</div>
    </fieldset>
  );
}
