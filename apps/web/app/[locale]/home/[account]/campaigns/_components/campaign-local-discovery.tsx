'use client';

import { Laptop } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { toast } from '@kit/ui/sonner';
import { Spinner } from '@kit/ui/spinner';
import { Switch } from '@kit/ui/switch';
import { Trans } from '@kit/ui/trans';

import { setLocalDiscoveryAction } from '../_lib/server/campaign-lifecycle-actions';

/**
 * Recherche Google Maps sur l'ordinateur dédié (sans proxy). L'interrupteur
 * n'est montré qu'aux utilisateurs autorisés ; les autres membres voient
 * seulement une note si la campagne est basculée.
 */
export function CampaignLocalDiscovery(props: {
  campaignId: string;
  allowed: boolean;
  enabled: boolean;
  minutesAgo: number | null;
}) {
  const t = useTranslations();

  const toggle = useAction(setLocalDiscoveryAction, {
    onSuccess: ({ data }) => {
      toast.success(
        t(
          data?.enabled
            ? 'campaigns.localDiscovery.enabledToast'
            : 'campaigns.localDiscovery.disabledToast',
        ),
      );
    },
    onError: ({ error }) => {
      toast.error(t(error.serverError ?? 'campaigns.localDiscovery.failed'));
    },
  });

  if (!props.allowed && !props.enabled) {
    return null;
  }

  const enabled = toggle.isPending
    ? (toggle.input?.enabled ?? props.enabled)
    : props.enabled;

  return (
    <div
      className={'flex items-start gap-3 rounded-lg border p-4'}
      data-test={'campaign-local-discovery'}
    >
      {props.allowed ? (
        <Switch
          checked={enabled}
          disabled={toggle.isPending}
          aria-label={t('campaigns.localDiscovery.title')}
          data-test={'campaign-local-discovery-switch'}
          onCheckedChange={(checked) =>
            toggle.execute({ campaignId: props.campaignId, enabled: checked })
          }
        />
      ) : (
        <Laptop className={'text-muted-foreground mt-0.5 h-4 w-4 shrink-0'} />
      )}

      <div className={'flex flex-col gap-1'}>
        <span className={'flex items-center gap-2 text-sm font-medium'}>
          <Trans i18nKey={'campaigns.localDiscovery.title'} />
          {toggle.isPending ? <Spinner className={'size-3.5'} /> : null}
        </span>

        <p className={'text-muted-foreground text-sm'}>
          <Trans
            i18nKey={
              enabled
                ? 'campaigns.localDiscovery.onHint'
                : 'campaigns.localDiscovery.offHint'
            }
          />
        </p>

        {enabled && props.allowed ? (
          <p
            className={'text-muted-foreground text-sm'}
            data-test={'campaign-local-discovery-status'}
          >
            <LastSeen minutesAgo={props.minutesAgo} />
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LastSeen(props: { minutesAgo: number | null }) {
  if (props.minutesAgo === null) {
    return <Trans i18nKey={'campaigns.localDiscovery.neverSeen'} />;
  }

  const minutes = Math.max(0, props.minutesAgo);

  if (minutes < 1) {
    return <Trans i18nKey={'campaigns.localDiscovery.seenNow'} />;
  }

  return (
    <Trans i18nKey={'campaigns.localDiscovery.seenAgo'} values={{ minutes }} />
  );
}
