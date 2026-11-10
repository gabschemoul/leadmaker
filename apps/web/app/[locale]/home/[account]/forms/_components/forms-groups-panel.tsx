'use client';

/**
 * Rôle : onglets de la page Formulaires (Prêts, À compléter, Envoyés…) et leur tableau, changés dans le
 * navigateur (10/11/2026, « PARTOUT sur l'app ça doit être instantané ») : les autres onglets sont chargés en
 * avance au premier affichage, un clic montre donc la liste tout de suite. L'adresse (?status=) suit en
 * silence pour qu'un rechargement garde l'onglet. Données : fetchAttempts (RLS). Écritures : aucune ici.
 */
import { useEffect, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import {
  ALWAYS_VISIBLE_GROUPS,
  ATTEMPT_GROUP_ORDER,
  type AttemptGroup,
} from '~/lib/leadmaker/attempts';
import { type AttemptRow, fetchAttempts } from '~/lib/leadmaker/attempts-query';

import { FormsTable } from './forms-table';

export function FormsGroupsPanel(props: {
  spaceId: string;
  accountId: string;
  counts: Record<AttemptGroup, number>;
  initialGroup: AttemptGroup;
  initialRows: AttemptRow[];
}) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const [group, setGroup] = useState(props.initialGroup);

  const keyFor = (target: AttemptGroup) => [
    'lm-space-attempts',
    props.spaceId,
    target,
  ];

  const visibleGroups = ATTEMPT_GROUP_ORDER.filter(
    (item) => ALWAYS_VISIBLE_GROUPS.includes(item) || props.counts[item] > 0,
  );

  const { data, isFetching } = useQuery({
    queryKey: keyFor(group),
    queryFn: () => fetchAttempts(client, { spaceId: props.spaceId, group }),
    initialData: group === props.initialGroup ? props.initialRows : undefined,
    staleTime: 15_000,
  });

  // chargement en avance des autres onglets non vides : le clic n'attend plus le serveur
  // (effet justifié : lancer des requêtes après le premier affichage, une fois par dossier)
  useEffect(() => {
    for (const item of visibleGroups) {
      if (item === props.initialGroup || props.counts[item] === 0) continue;

      void queryClient.prefetchQuery({
        queryKey: ['lm-space-attempts', props.spaceId, item],
        queryFn: () =>
          fetchAttempts(client, { spaceId: props.spaceId, group: item }),
        staleTime: 15_000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.spaceId]);

  const refetchRows = () =>
    void queryClient.invalidateQueries({
      queryKey: ['lm-space-attempts', props.spaceId],
    });

  const select = (target: AttemptGroup) => {
    setGroup(target);

    const url = new URL(window.location.href);

    if (target === 'ready') {
      url.searchParams.delete('status');
    } else {
      url.searchParams.set('status', target);
    }

    window.history.replaceState(null, '', url);
  };

  return (
    <div className={'flex flex-col gap-4'}>
      <nav
        className={'flex flex-wrap items-center gap-2'}
        data-test={'forms-groups'}
      >
        {visibleGroups.map((item) => (
          <button
            key={item}
            type={'button'}
            onClick={() => select(item)}
            aria-pressed={item === group}
            data-test={`forms-group-${item}`}
            className={cn(
              'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] font-medium whitespace-nowrap transition-colors',
              item === group
                ? 'bg-brand-pale text-brand-hover dark:text-brand'
                : 'bg-card text-foreground ring-pill-ring shadow-soft hover:bg-muted ring-[0.5px]',
            )}
          >
            <span>
              <Trans i18nKey={`outreach.forms.groups.${item}`} />
            </span>

            <span
              className={cn(
                'text-xs tabular-nums',
                item === group ? 'opacity-70' : 'text-muted-foreground',
              )}
            >
              {props.counts[item]}
            </span>
          </button>
        ))}

        {isFetching ? (
          <Loader2 className={'text-muted-foreground size-4 animate-spin'} />
        ) : null}
      </nav>

      <p
        className={'text-muted-foreground text-sm'}
        data-test={'forms-group-hint'}
      >
        <Trans i18nKey={`outreach.forms.groupHints.${group}`} />
      </p>

      {data ? (
        <FormsTable
          key={`${props.spaceId}:${group}`}
          rows={data}
          group={group}
          accountId={props.accountId}
          spaceId={props.spaceId}
          preparing={props.counts.preparing}
          onRefresh={refetchRows}
        />
      ) : (
        <div
          className={'flex justify-center py-12'}
          aria-busy={true}
          data-test={'forms-loading'}
        >
          <Loader2 className={'text-muted-foreground size-5 animate-spin'} />
        </div>
      )}
    </div>
  );
}
