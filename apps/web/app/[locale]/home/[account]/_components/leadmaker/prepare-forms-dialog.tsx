'use client';

import { useState } from 'react';

import Link from 'next/link';

import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Label } from '@kit/ui/label';
import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import { prepareProspectsAction } from '../../prospects/_lib/server/server-actions';

export interface CampaignOption {
  id: string;
  name: string;
}

/**
 * Confirmation avant de mettre des prospects en préparation. Quand certains
 * prospects n'ont pas de campagne (import), l'utilisateur choisit celle dont
 * les messages serviront.
 */
export function PrepareFormsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  ids: string[];
  needsCampaign: boolean;
  campaigns: CampaignOption[];
  formsHref?: string;
  onDone?: () => void;
}) {
  const t = useTranslations('outreach.forms.prepare');
  const [campaignId, setCampaignId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { execute, isPending } = useAction(prepareProspectsAction, {
    onExecute: () => setError(null),
    onSuccess: ({ data }) => {
      toast.success(
        t('done', { queued: data?.queued ?? 0, skipped: data?.skipped ?? 0 }),
        props.formsHref
          ? {
              action: {
                label: t('goToForms'),
                onClick: () => window.location.assign(props.formsHref!),
              },
            }
          : undefined,
      );

      props.onOpenChange(false);
      props.onDone?.();
    },
    onNavigation: () => props.onOpenChange(false),
    onError: ({ error }) =>
      setError(error.serverError ?? 'outreach.forms.prepare.failed'),
  });

  const submit = () => {
    if (props.needsCampaign && !campaignId) {
      setError('outreach.forms.prepare.campaignRequired');
      return;
    }

    execute({
      accountId: props.accountId,
      ids: props.ids,
      campaignId: props.needsCampaign ? campaignId : null,
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!isPending) props.onOpenChange(open);
      }}
    >
      <DialogContent data-test={'prepare-forms-dialog'}>
        <DialogHeader>
          <DialogTitle>{t('title', { count: props.ids.length })}</DialogTitle>

          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {props.needsCampaign ? (
          <div className={'flex flex-col gap-2'}>
            <Label>{t('campaignLabel')}</Label>

            <NativeSelect
              className={'w-full'}
              data-test={'prepare-campaign-select'}
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
            >
              <NativeSelectOption value={''}>—</NativeSelectOption>

              {props.campaigns.map((campaign) => (
                <NativeSelectOption key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>

            <p className={'text-muted-foreground text-xs'}>
              {t('campaignHint')}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className={'text-destructive text-sm'} data-test={'prepare-error'}>
            <Trans i18nKey={error} />{' '}
            {error === 'outreach.forms.prepare.noSender' && props.formsHref
              ? null
              : null}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type={'button'}
            variant={'outline'}
            disabled={isPending}
            onClick={() => props.onOpenChange(false)}
          >
            <Trans i18nKey={'common.cancel'} />
          </Button>

          <Button
            type={'button'}
            data-test={'prepare-submit'}
            disabled={isPending}
            onClick={submit}
          >
            {t('submit')}
          </Button>
        </DialogFooter>

        {props.formsHref ? (
          <Link className={'sr-only'} href={props.formsHref}>
            {t('goToForms')}
          </Link>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
