'use client';

/**
 * Rôle : liste des expéditeurs + formulaire de l'expéditeur choisi, changés sur place (10/11/2026, « PARTOUT
 * sur l'app ça doit être instantané ») : tous les expéditeurs du dossier sont déjà chargés, « Modifier » et
 * « Ajouter » montrent le bon formulaire tout de suite au lieu de recharger la page. L'adresse (?sender=)
 * suit en silence. Écritures : dans SenderList / SenderProfileForm (actions serveur).
 */
import { useState } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

import type { SenderProfileFormValues } from '../_lib/schema/sender-profile.schema';
import { SenderList } from './sender-list';
import { SenderProfileForm } from './sender-profile-form';

interface SenderEntry {
  id: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  is_default: boolean;
  label: string;
  defaultValues: SenderProfileFormValues;
}

export function SendersWorkspace(props: {
  senders: SenderEntry[];
  /** expéditeur demandé dans l'adresse : un identifiant, 'new' ou rien (celui par défaut) */
  initialSelected: string | null;
  emptyValues: SenderProfileFormValues;
  accountId: string;
  accountSlug: string;
  spaceId: string;
  countries: React.ComponentProps<typeof SenderProfileForm>['countries'];
  /** sélecteur de dossier (plusieurs dossiers seulement) */
  folderSwitch: React.ReactNode;
}) {
  const [selected, setSelected] = useState(props.initialSelected);

  const creating = selected === 'new' || props.senders.length === 0;

  const profile = creating
    ? null
    : (props.senders.find((sender) => sender.id === selected) ??
      props.senders[0] ??
      null);

  const select = (id: string | 'new') => {
    setSelected(id);

    const url = new URL(window.location.href);
    url.searchParams.set('sender', id);
    window.history.replaceState(null, '', url);
  };

  return (
    <>
      {props.senders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey={'outreach.sender.listTitle'} />
            </CardTitle>

            <CardDescription className={'max-w-xl'}>
              <Trans i18nKey={'outreach.sender.listIntro'} />
            </CardDescription>
          </CardHeader>

          <CardContent>
            <SenderList
              senders={props.senders}
              selectedId={profile?.id ?? null}
              onSelect={select}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className={'flex flex-col gap-4'}>
          <div className={'flex flex-col gap-1.5'}>
            <CardTitle data-test={'sender-form-title'}>
              {profile ? (
                <Trans
                  i18nKey={'outreach.sender.editTitle'}
                  values={{ name: profile.label }}
                />
              ) : (
                <Trans i18nKey={'outreach.sender.newTitle'} />
              )}
            </CardTitle>

            <CardDescription className={'max-w-xl'}>
              <Trans i18nKey={'outreach.sender.intro'} />
            </CardDescription>
          </div>

          {props.folderSwitch}
        </CardHeader>

        <CardContent>
          <SenderProfileForm
            // autre expéditeur ou autre dossier : le formulaire repart de ses valeurs
            key={`${props.spaceId}:${profile?.id ?? 'new'}`}
            accountId={props.accountId}
            accountSlug={props.accountSlug}
            spaceId={props.spaceId}
            senderId={profile?.id}
            countries={props.countries}
            defaultValues={profile?.defaultValues ?? props.emptyValues}
          />
        </CardContent>
      </Card>
    </>
  );
}
