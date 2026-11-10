'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm, useWatch } from 'react-hook-form';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Trans } from '@kit/ui/trans';

import { DAILY_LIMIT_MAX } from '../../_lib/schema/templates.schema';
import { saveCampaignSendingAction } from '../../_lib/server/campaign-outreach-actions';

interface SendingValues {
  dailyLimit: string;
  autoValidation: boolean;
}

/**
 * Rôle : réglages d'envoi du mode avancé (étape Envoi) — prises de contact par jour, au maximum, et validation
 * automatique. Affichés directement dans l'étape (écran 4 du CDC-PARCOURS-TRI-ANNUAIRE §6, 10/11/2026) au lieu
 * d'une fenêtre : mêmes champs, mêmes bornes, mêmes textes, même action.
 * Données : valeurs actuelles de la campagne (props). Modifications : saveCampaignSendingAction.
 * Le pilote automatique a son propre rythme (sa planification) : ces deux réglages ne s'appliquent qu'aux
 * formulaires validés hors pilote (lm_queue_sends).
 */
export function CampaignSendingSettings(props: {
  campaignId: string;
  dailyLimit: number;
  autoValidation: boolean;
  autoValidationAllowed: boolean;
  /** entreprises pas encore contactées (null = inconnu) : pour « ≈ N jours pour tout envoyer » */
  contactable: number | null;
}) {
  const t = useTranslations();

  const form = useForm<SendingValues>({
    defaultValues: {
      dailyLimit: String(props.dailyLimit),
      autoValidation: props.autoValidation,
    },
  });

  const save = useAction(saveCampaignSendingAction, {
    onSuccess: ({ input }) => {
      // les valeurs enregistrées deviennent la nouvelle référence (bouton désactivé tant que rien ne change)
      form.reset({
        dailyLimit: String(input.dailyLimit),
        autoValidation: input.autoValidation,
      });
      toast.success(t('outreach.messages.saved'));
    },
    onError: ({ error }) =>
      toast.error(t(error.serverError ?? 'outreach.messages.saveFailed')),
  });

  const values = useWatch({ control: form.control });
  const limit = Number(values.dailyLimit);
  const limitValid =
    Number.isInteger(limit) && limit >= 1 && limit <= DAILY_LIMIT_MAX;

  const daysToSend =
    limitValid && props.contactable !== null && props.contactable > 0
      ? Math.ceil(props.contactable / limit)
      : null;

  const submit = form.handleSubmit((input) =>
    save.execute({
      campaignId: props.campaignId,
      dailyLimit: Number(input.dailyLimit),
      autoValidation: input.autoValidation,
    }),
  );

  return (
    <Form {...form}>
      <form
        onSubmit={submit}
        // rangé dans la fenêtre « Réglages d'envoi » depuis le 10/11/2026 : plus de carte ni de texte d'intro
        className={'flex flex-col gap-5'}
        data-test={'sending-settings'}
      >
        <FormField
          control={form.control}
          name={'dailyLimit'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'outreach.messages.sending.dailyLimit'} />
              </FormLabel>

              <div className={'flex flex-wrap items-center gap-3'}>
                <FormControl className={'w-40'}>
                  <Input
                    type={'number'}
                    min={1}
                    max={DAILY_LIMIT_MAX}
                    inputMode={'numeric'}
                    data-test={'sending-daily-limit'}
                    className={'tabular-nums'}
                    {...field}
                  />
                </FormControl>

                {daysToSend !== null ? (
                  <span
                    className={'text-muted-foreground text-sm tabular-nums'}
                    data-test={'sending-days-to-send'}
                  >
                    <Trans
                      i18nKey={'outreach.sendStep.daysToSend'}
                      values={{ count: daysToSend }}
                    />
                  </span>
                ) : null}
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={'autoValidation'}
          render={({ field }) => (
            <FormItem className={'flex flex-col gap-3 border-t pt-5'}>
              <div className={'flex items-center gap-3'}>
                <FormControl
                  render={
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!props.autoValidationAllowed}
                      data-test={'sending-auto-validation'}
                    />
                  }
                />

                <div className={'flex flex-col gap-1'}>
                  <FormLabel>
                    <Trans
                      i18nKey={'outreach.messages.sending.autoValidation'}
                    />
                  </FormLabel>

                  {props.autoValidationAllowed ? null : (
                    <FormDescription>
                      <Trans
                        i18nKey={
                          'outreach.messages.sending.autoValidationPlanHint'
                        }
                      />
                    </FormDescription>
                  )}
                </div>
              </div>

              {field.value ? (
                <Alert className={alertExtras.warning}>
                  <TriangleAlert className={'h-4'} />
                  <AlertDescription>
                    <Trans
                      i18nKey={
                        'outreach.messages.sending.autoValidationWarning'
                      }
                    />
                  </AlertDescription>
                </Alert>
              ) : null}
            </FormItem>
          )}
        />

        <div className={'flex justify-end'}>
          <Button
            type={'submit'}
            data-test={'sending-settings-save'}
            disabled={!limitValid || !form.formState.isDirty}
            loading={save.isPending}
          >
            <Trans i18nKey={'campaigns.steps.contact.settings.save'} />
          </Button>
        </div>
      </form>
    </Form>
  );
}
