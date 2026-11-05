'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';

import { saveNotificationPreferencesAction } from '../_lib/server/notification-actions';

const GROUPS = ['autopilot', 'search', 'credits'] as const;

type Group = (typeof GROUPS)[number];

/**
 * Rôle : carte « Notifications par e-mail » de la page Profil (5/11/2026).
 * Données : groupes déjà coupés (lm_notification_preferences). Modification : saveNotificationPreferencesAction.
 */
export function NotificationPreferences(props: { disabledGroups: string[] }) {
  const t = useTranslations('account.notifications');
  const [disabled, setDisabled] = useState<Group[]>(
    props.disabledGroups.filter((group): group is Group =>
      (GROUPS as readonly string[]).includes(group),
    ),
  );

  const save = useAction(saveNotificationPreferencesAction, {
    onSuccess: () => toast.success(t('saved')),
    onError: () => toast.error(t('saveFailed')),
  });

  const toggle = (group: Group, enabled: boolean) => {
    const next = enabled
      ? disabled.filter((item) => item !== group)
      : [...disabled, group];

    setDisabled(next);
    save.execute({ disabledGroups: next });
  };

  return (
    <Card data-test={'notification-preferences'}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-5'}>
        {GROUPS.map((group) => (
          <div key={group} className={'flex items-start gap-3'}>
            <Switch
              id={`notification-${group}`}
              data-test={`notification-${group}`}
              checked={!disabled.includes(group)}
              disabled={save.isPending}
              onCheckedChange={(enabled) => toggle(group, enabled)}
            />

            <label
              htmlFor={`notification-${group}`}
              className={'flex flex-col gap-1'}
            >
              <span className={'text-sm font-medium'}>
                {t(`${group}.label`)}
              </span>
              <span className={'text-muted-foreground text-sm'}>
                {t(`${group}.hint`)}
              </span>
            </label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
