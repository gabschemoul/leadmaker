'use client';

/**
 * Rôle : carte « Votre offre » des réglages de l'équipe (CDC-PARCOURS-TRI-ANNUAIRE §3.1).
 * Données : offre du dossier choisi, passée par la page Réglages.
 * Écritures : saveSpaceOfferAction (lm_set_space_offer).
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
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { Trans } from '@kit/ui/trans';

import { SpaceOfferFormSchema } from '../_lib/schema/space-offer.schema';
import { saveSpaceOfferAction } from '../_lib/server/space-offer-actions';

export function SpaceOfferForm(props: { spaceId: string; offer: string }) {
  const t = useTranslations();

  const form = useForm({
    resolver: zodResolver(SpaceOfferFormSchema),
    defaultValues: { offer: props.offer },
  });

  const { execute, isPending } = useAction(saveSpaceOfferAction, {
    onSuccess: ({ input }) => {
      form.reset({ offer: input.offer.trim() });
      toast.success(t('teams.settings.offer.saved'));
    },
    onError: ({ error }) =>
      toast.error(t(error.serverError ?? 'teams.settings.offer.saveFailed')),
  });

  return (
    <Form {...form}>
      <form
        data-test={'space-offer-form'}
        className={'flex flex-col gap-4'}
        onSubmit={form.handleSubmit((values) =>
          execute({ ...values, spaceId: props.spaceId }),
        )}
      >
        <FormField
          name={'offer'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'campaigns.form.who.offerLabel'} />
              </FormLabel>

              <FormControl>
                <Textarea
                  data-test={'space-offer-input'}
                  rows={3}
                  maxLength={1000}
                  placeholder={t('campaigns.form.who.offerPlaceholder')}
                  {...field}
                />
              </FormControl>

              <FormDescription>
                <Trans i18nKey={'teams.settings.offer.hint'} />
              </FormDescription>

              <FormMessage />
            </FormItem>
          )}
        />

        <div>
          <Button
            type={'submit'}
            data-test={'space-offer-save'}
            loading={isPending}
            disabled={isPending || !form.formState.isDirty}
          >
            <Trans i18nKey={'teams.settings.offer.save'} />
          </Button>
        </div>
      </form>
    </Form>
  );
}
