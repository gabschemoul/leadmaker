import Link from 'next/link';

import { UserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

import type { CampaignTemplates } from '~/lib/leadmaker/templates';

import type { SenderProfile } from '../../../sender/_lib/server/sender.loader';
import type { loadPreviewProspects } from '../../_lib/server/campaigns.loader';
import { CampaignMessagesForm } from '../campaign-messages-form';
import { CampaignSenderSelect } from '../campaign-sender-select';

/**
 * Étape 3, Rédiger : l'expéditeur (qui envoie) puis les messages de la
 * campagne et ses réglages d'envoi.
 */
export async function WriteStep(props: {
  accountId: string;
  campaignId: string;
  templates: CampaignTemplates;
  sender: SenderProfile | null;
  senderHref: string;
  prospects: Awaited<ReturnType<typeof loadPreviewProspects>>;
  sending: {
    dailyLimit: number;
    autoValidation: boolean;
    autoValidationAllowed: boolean;
  };
  companyOptional: boolean;
  /** expéditeurs de l'organisation, pour choisir celui de la campagne */
  senders: Array<{
    id: string;
    first_name: string;
    last_name: string;
    company: string;
    is_default: boolean;
  }>;
  /** expéditeur choisi pour la campagne (null = celui par défaut) */
  chosenSenderId: string | null;
}) {
  const t = await getTranslations('campaigns.steps.write');
  const { sender } = props;

  return (
    <div className={'flex flex-col gap-4'} data-test={'campaign-step-write'}>
      <Card data-test={'campaign-sender-card'}>
        <CardHeader>
          <CardTitle>{t('senderTitle')}</CardTitle>
          <CardDescription>{t('senderIntro')}</CardDescription>
        </CardHeader>

        <CardContent
          className={
            'flex flex-wrap items-center justify-between gap-4 text-sm'
          }
        >
          {sender ? (
            <div className={'flex items-center gap-3'}>
              <span
                className={
                  'bg-accent text-accent-foreground inline-flex size-10 items-center justify-center rounded-full font-medium'
                }
              >
                {initials(sender.first_name, sender.last_name)}
              </span>

              <div className={'flex flex-col'}>
                <span className={'font-medium'}>
                  {sender.first_name} {sender.last_name} · {sender.company}
                </span>
                <span className={'text-muted-foreground'}>
                  {[sender.email, sender.phone].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
          ) : (
            <div className={'text-muted-foreground flex items-center gap-3'}>
              <UserRound className={'size-5'} />
              <span>{t('senderMissing')}</span>
            </div>
          )}

          <Button
            variant={sender ? 'outline' : 'default'}
            size={'sm'}
            nativeButton={false}
            data-test={'campaign-sender-link'}
            render={<Link href={props.senderHref} />}
          >
            {sender ? t('senderEdit') : t('senderFill')}
          </Button>

          {props.senders.length > 1 ? (
            <div className={'w-full border-t pt-4'}>
              <CampaignSenderSelect
                campaignId={props.campaignId}
                senders={props.senders}
                chosenSenderId={props.chosenSenderId}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <CampaignMessagesForm
        accountId={props.accountId}
        campaignId={props.campaignId}
        templates={props.templates}
        sender={
          sender
            ? {
                first_name: sender.first_name,
                last_name: sender.last_name,
                company: sender.company,
                email: sender.email,
                phone: sender.phone,
                website: sender.website,
              }
            : null
        }
        senderHref={props.senderHref}
        prospects={props.prospects}
        sending={props.sending}
        companyOptional={props.companyOptional}
      />
    </div>
  );
}

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}
