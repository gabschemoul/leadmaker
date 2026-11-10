'use client';

/**
 * Rôle : fenêtre « Réglages d'envoi » du mode Avancé (10/11/2026) : les réglages qui encombraient l'écran
 * (prises de contact par jour, validation automatique, expéditeur) sont rangés ici, derrière un bouton.
 * Données / écritures : celles des composants passés en enfants (CampaignSendingSettings, ContactSender).
 */
import { Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';

export function SendingSettingsDialog(props: { children: React.ReactNode }) {
  const t = useTranslations('campaigns.steps.contact.settings');

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant={'outline'} data-test={'sending-settings-open'} />
        }
      >
        <Settings2 />
        {t('open')}
      </DialogTrigger>

      <DialogContent className={'sm:max-w-lg'}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className={'flex flex-col gap-5'}>{props.children}</div>
      </DialogContent>
    </Dialog>
  );
}
