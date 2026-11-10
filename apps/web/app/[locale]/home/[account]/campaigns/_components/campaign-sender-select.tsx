'use client';

import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';
import { Spinner } from '@kit/ui/spinner';

import { panelSelectClasses } from '../../_components/leadmaker/panel-classes';
import { senderLabel } from '../../sender/_lib/sender-label';
import { setCampaignSenderAction } from '../_lib/server/campaign-outreach-actions';

/**
 * Expéditeur de la campagne : celui par défaut de l'organisation, ou un autre
 * choisi pour elle. Le choix s'enregistre tout de suite.
 */
export function CampaignSenderSelect(props: {
  campaignId: string;
  senders: Array<{
    id: string;
    first_name: string;
    last_name: string;
    company: string;
    is_default: boolean;
  }>;
  /** null = l'expéditeur par défaut */
  chosenSenderId: string | null;
  /** panneau « Réglages » du pilote : sans libellé, au gabarit des sélecteurs du panneau */
  compact?: boolean;
}) {
  const t = useTranslations('campaigns.steps.write');

  const save = useAction(setCampaignSenderAction, {
    onSuccess: () => toast.success(t('senderChosen')),
    onError: ({ error }) =>
      toast.error(
        t(
          error.serverError?.replace('campaigns.steps.write.', '') ??
            'senderChooseFailed',
        ),
      ),
  });

  const fallback = props.senders.find((sender) => sender.is_default);

  const value = save.isPending
    ? (save.input?.senderId ?? '')
    : (props.chosenSenderId ?? '');

  return (
    <label className={'flex flex-col gap-1.5 text-sm'}>
      {props.compact ? null : (
        <span className={'flex items-center gap-2 font-medium'}>
          {t('senderChoose')}
          {save.isPending ? <Spinner className={'size-3.5'} /> : null}
        </span>
      )}

      <NativeSelect
        aria-label={t('senderChoose')}
        className={props.compact ? panelSelectClasses : 'w-full max-w-sm'}
        data-test={'campaign-sender-select'}
        disabled={save.isPending}
        value={value}
        onChange={(event) =>
          save.execute({
            campaignId: props.campaignId,
            senderId: event.target.value || null,
          })
        }
      >
        <NativeSelectOption value={''}>
          {fallback
            ? t('senderDefaultOption', { name: senderLabel(fallback) })
            : t('senderDefaultOptionEmpty')}
        </NativeSelectOption>

        {props.senders
          .filter((sender) => !sender.is_default)
          .map((sender) => (
            <NativeSelectOption key={sender.id} value={sender.id}>
              {senderLabel(sender)}
            </NativeSelectOption>
          ))}
      </NativeSelect>
    </label>
  );
}
