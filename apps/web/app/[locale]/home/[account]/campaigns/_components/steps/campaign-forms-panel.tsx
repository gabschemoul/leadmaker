'use client';

import { useEffect, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

import {
  ALWAYS_VISIBLE_GROUPS,
  ATTEMPT_GROUP_ORDER,
  type AttemptGroup,
} from '~/lib/leadmaker/attempts';
import { type AttemptRow, fetchAttempts } from '~/lib/leadmaker/attempts-query';

import { Kpi, KpiStrip } from '../../../_components/leadmaker/kpi-strip';
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
  /** boutons en haut à droite de la carte (réglages, préparer) */
  actions?: React.ReactNode;
}) {
  const t = useTranslations('campaigns.steps.contact');
  const format = useFormatter();
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

  const tab = tabOf(group);
  const asideGroups = ASIDE_GROUPS.filter(
    (item) => ALWAYS_VISIBLE_GROUPS.includes(item) || props.counts[item] > 0,
  );
  const asideCount = ASIDE_GROUPS.reduce(
    (sum, item) => sum + props.counts[item],
    0,
  );

  return (
    <Card className={'gap-0 pb-0'}>
      <CardHeader
        className={'flex flex-row flex-wrap items-center justify-between gap-3'}
      >
        <CardTitle className={'flex items-center gap-2'}>
          {t('formsTitle')}
          {isFetching ? (
            <Loader2 className={'text-muted-foreground size-4 animate-spin'} />
          ) : null}
        </CardTitle>

        {props.actions ? (
          <div className={'flex flex-wrap items-center gap-2'}>
            {props.actions}
          </div>
        ) : null}
      </CardHeader>

      {/* onglets façon ElevenLabs : une tuile par étape, « Mis de côté » regroupe les cas sans envoi */}
      <div className={'mt-4 border-y'} data-test={'forms-groups'}>
        <KpiStrip>
          {MAIN_TABS.map((item) => (
            <Kpi
              key={item}
              label={t(`tabs.${item}`)}
              value={format.number(props.counts[item])}
              active={tab === item}
              onClick={() => select(item)}
              testId={`forms-group-${item}`}
            />
          ))}

          <Kpi
            label={t('tabs.aside')}
            value={format.number(asideCount)}
            active={tab === 'aside'}
            onClick={() =>
              select(
                asideGroups.find((item) => props.counts[item] > 0) ??
                  'incomplete',
              )
            }
            testId={'forms-group-aside'}
          />
        </KpiStrip>
      </div>

      <CardContent className={'flex flex-col gap-3 pt-4'}>
        {tab === 'aside' ? (
          <nav
            className={'flex flex-wrap gap-2'}
            data-test={'forms-aside-groups'}
          >
            {asideGroups.map((item) => (
              <Button
                key={item}
                variant={'chip'}
                aria-pressed={item === group}
                data-test={`forms-group-${item}`}
                onClick={() => select(item)}
              >
                <Trans i18nKey={`outreach.forms.groups.${item}`} />
                <span className={'text-muted-foreground tabular-nums'}>
                  {format.number(props.counts[item])}
                </span>
              </Button>
            ))}
          </nav>
        ) : null}

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

/** Les quatre étapes affichées en onglets ; tout le reste (pas envoyable en l'état) va dans « Mis de côté ». */
const MAIN_TABS = ['ready', 'validated', 'sent', 'to_verify'] as const;
const ASIDE_GROUPS: AttemptGroup[] = [
  'incomplete',
  'intervention_required',
  'no_form',
  'unreachable',
  'skipped',
  'excluded',
];

function tabOf(group: AttemptGroup) {
  return (MAIN_TABS as readonly AttemptGroup[]).includes(group)
    ? (group as (typeof MAIN_TABS)[number])
    : 'aside';
}
