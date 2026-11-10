'use client';

import { useEffect, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import {
  ALWAYS_VISIBLE_GROUPS,
  ATTEMPT_GROUP_ORDER,
  type AttemptGroup,
} from '~/lib/leadmaker/attempts';
import { type AttemptRow, fetchAttempts } from '~/lib/leadmaker/attempts-query';

import { FormsTable } from '../../../forms/_components/forms-table';

/**
 * Les formulaires d'une campagne, par statut. Le changement d'onglet se fait
 * dans le navigateur : une seule requête, sans recharger la page. L'adresse
 * (`?statut=`) est tenue à jour pour qu'un rechargement garde l'onglet.
 */
export function CampaignFormsPanel(props: {
  campaignId: string;
  spaceId: string;
  accountId: string;
  counts: Record<AttemptGroup, number>;
  initialGroup: AttemptGroup;
  initialRows: AttemptRow[];
  total: number;
}) {
  const t = useTranslations('campaigns.steps.contact');
  const client = useSupabase();
  const queryClient = useQueryClient();
  const [group, setGroup] = useState(props.initialGroup);

  const queryKey = ['lm-campaign-attempts', props.campaignId, group];

  const { data, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      fetchAttempts(client, {
        spaceId: props.spaceId,
        campaignId: props.campaignId,
        group,
      }),
    initialData: group === props.initialGroup ? props.initialRows : undefined,
    staleTime: 5_000,
  });

  // chargement en avance des autres onglets non vides (10/11/2026) : un clic montre la liste tout de suite
  // (effet justifié : lancer des requêtes après le premier affichage, une fois par campagne)
  useEffect(() => {
    for (const item of ATTEMPT_GROUP_ORDER) {
      if (item === props.initialGroup || props.counts[item] === 0) continue;

      void queryClient.prefetchQuery({
        queryKey: ['lm-campaign-attempts', props.campaignId, item],
        queryFn: () =>
          fetchAttempts(client, {
            spaceId: props.spaceId,
            campaignId: props.campaignId,
            group: item,
          }),
        staleTime: 5_000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.campaignId]);

  const refetchRows = () =>
    void queryClient.invalidateQueries({
      queryKey: ['lm-campaign-attempts', props.campaignId],
    });

  const select = (target: AttemptGroup) => {
    setGroup(target);

    const url = new URL(window.location.href);
    url.searchParams.set('etape', 'contacter');

    if (target === 'ready') {
      url.searchParams.delete('statut');
    } else {
      url.searchParams.set('statut', target);
    }

    window.history.replaceState(null, '', url);
  };

  const visibleGroups = ATTEMPT_GROUP_ORDER.filter(
    (item) => ALWAYS_VISIBLE_GROUPS.includes(item) || props.counts[item] > 0,
  );

  return (
    <Card>
      <CardHeader className={'flex flex-col gap-4'}>
        <CardTitle className={'flex items-center gap-2'}>
          {t('formsTitle')}
          {isFetching ? (
            <Loader2 className={'text-muted-foreground size-4 animate-spin'} />
          ) : null}
        </CardTitle>

        <nav className={'flex flex-wrap gap-2'} data-test={'forms-groups'}>
          {visibleGroups.map((item) => (
            <Button
              key={item}
              size={'sm'}
              variant={item === group ? 'default' : 'outline'}
              data-test={`forms-group-${item}`}
              onClick={() => select(item)}
            >
              <Trans i18nKey={`outreach.forms.groups.${item}`} />

              <span
                className={cn(
                  'tabular-nums',
                  item === group ? 'opacity-80' : 'text-muted-foreground',
                )}
              >
                {props.counts[item]}
              </span>
            </Button>
          ))}
        </nav>

        <p
          className={'text-muted-foreground text-sm'}
          data-test={'forms-group-hint'}
        >
          {props.total === 0 ? (
            t('formsEmpty')
          ) : (
            <Trans i18nKey={`outreach.forms.groupHints.${group}`} />
          )}
        </p>
      </CardHeader>

      <CardContent>
        <FormsTable
          key={`${props.campaignId}:${group}`}
          rows={data ?? []}
          group={group}
          accountId={props.accountId}
          spaceId={props.spaceId}
          preparing={props.counts.preparing}
          onRefresh={refetchRows}
        />
      </CardContent>
    </Card>
  );
}
