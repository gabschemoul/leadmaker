'use client';

import { useState } from 'react';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Trans } from '@kit/ui/trans';

import { DAILY_LIMIT_MAX } from '../../_lib/schema/templates.schema';
import { saveCampaignSendingAction } from '../../_lib/server/campaign-outreach-actions';

/**
 * Rôle : fenêtre « Réglages d'envoi » du mode avancé (étape Contacter) — envois par jour et validation automatique.
 * Données : valeurs actuelles de la campagne (props). Modifications : saveCampaignSendingAction.
 * Déplacée depuis l'étape Rédiger le 5/11/2026 (audit E10) : le pilote automatique a son propre rythme.
 */
export function CampaignSendingSettings(props: {
  campaignId: string;
  dailyLimit: number;
  autoValidation: boolean;
  autoValidationAllowed: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(String(props.dailyLimit));
  const [autoValidation, setAutoValidation] = useState(props.autoValidation);

  const save = useAction(saveCampaignSendingAction, {
    onSuccess: () => {
      setOpen(false);
      toast.success(t('outreach.messages.saved'));
    },
    onError: ({ error }) =>
      toast.error(t(error.serverError ?? 'outreach.messages.saveFailed')),
  });

  const limit = Number(dailyLimit);
  const limitValid =
    Number.isInteger(limit) && limit >= 1 && limit <= DAILY_LIMIT_MAX;

  return (
    <>
      <Button
        variant={'outline'}
        className={'mt-auto'}
        data-test={'contact-send-settings'}
        onClick={() => {
          setDailyLimit(String(props.dailyLimit));
          setAutoValidation(props.autoValidation);
          setOpen(true);
        }}
      >
        <Trans i18nKey={'campaigns.steps.contact.sendSettings'} />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!save.isPending) setOpen(next);
        }}
      >
        <DialogContent data-test={'sending-settings-dialog'}>
          <DialogHeader>
            <DialogTitle>
              <Trans i18nKey={'outreach.messages.sending.title'} />
            </DialogTitle>
            <DialogDescription>
              <Trans i18nKey={'outreach.messages.sending.intro'} />
            </DialogDescription>
          </DialogHeader>

          <div className={'flex flex-col gap-6'}>
            <div className={'flex max-w-xs flex-col gap-2'}>
              <Label htmlFor={'sending-daily-limit'}>
                <Trans i18nKey={'outreach.messages.sending.dailyLimit'} />
              </Label>
              <Input
                id={'sending-daily-limit'}
                type={'number'}
                min={1}
                max={DAILY_LIMIT_MAX}
                data-test={'sending-daily-limit'}
                value={dailyLimit}
                onChange={(event) => setDailyLimit(event.target.value)}
              />
              <p className={'text-muted-foreground text-sm'}>
                <Trans i18nKey={'outreach.messages.sending.dailyLimitHint'} />
              </p>
            </div>

            <div className={'flex items-start gap-3'}>
              <Switch
                id={'sending-auto-validation'}
                checked={autoValidation}
                onCheckedChange={setAutoValidation}
                disabled={!props.autoValidationAllowed}
                data-test={'sending-auto-validation'}
              />
              <div className={'flex flex-col gap-1'}>
                <Label htmlFor={'sending-auto-validation'}>
                  <Trans i18nKey={'outreach.messages.sending.autoValidation'} />
                </Label>
                <p className={'text-muted-foreground text-sm'}>
                  <Trans
                    i18nKey={
                      props.autoValidationAllowed
                        ? 'outreach.messages.sending.autoValidationHint'
                        : 'outreach.messages.sending.autoValidationPlanHint'
                    }
                  />
                </p>
              </div>
            </div>

            {autoValidation ? (
              <Alert className={alertExtras.warning}>
                <TriangleAlert className={'h-4'} />
                <AlertDescription>
                  <Trans
                    i18nKey={'outreach.messages.sending.autoValidationWarning'}
                  />
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant={'outline'}
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              <Trans i18nKey={'common.cancel'} />
            </Button>
            <Button
              data-test={'sending-settings-save'}
              disabled={save.isPending || !limitValid}
              onClick={() =>
                save.execute({
                  campaignId: props.campaignId,
                  dailyLimit: limit,
                  autoValidation,
                })
              }
            >
              <Trans i18nKey={'outreach.messages.save'} />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
