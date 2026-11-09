'use client';

/**
 * Rôle : encart des groupes de l'écran « Vos entreprises » (CDC-PARCOURS-TRI-ANNUAIRE §4.3) : « N groupes repérés.
 * Un message par groupe ? » avec « Un seul message » et « Créer N campagnes », puis la ligne qui rappelle le choix.
 * Données : `groups` de fetchCampaignLive (lm_campaign_groups), rafraîchi avec le reste de l'écran ; après coup,
 * les campagnes créées par groupe sont retrouvées par leur nom (lm_campaigns, lisible par les membres).
 * Écritures : setGroupsChoiceAction (lm_set_groups_choice), splitCampaignByGroupsAction
 * (lm_split_campaign_by_groups).
 */
import { useState } from 'react';

import Link from 'next/link';

import type { SupabaseClient } from '@supabase/supabase-js';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import type { Database } from '@kit/supabase/database';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import type { CampaignLive } from '../../_lib/campaign-live';
import {
  setGroupsChoiceAction,
  splitCampaignByGroupsAction,
} from '../../_lib/server/sort-actions';

type Groups = CampaignLive['groups'];

/** Part minimale des gardées pour qu'un groupe compte (§4.3 : au moins 2 groupes à 15 % ou plus). */
const GROUP_MIN_SHARE = 0.15;

type CreatedCampaign = { id: string; label: string; companies: number };

/** L'encart se propose : au moins 2 groupes pèsent chacun 15 % ou plus des gardées, et rien n'est encore choisi. */
function shouldPropose(groups: Groups) {
  if (groups.choice !== null || groups.totalKept <= 0) {
    return false;
  }

  const significant = groups.list.filter(
    (group) => group.kept / groups.totalKept >= GROUP_MIN_SHARE,
  );

  return significant.length >= 2;
}

/** Libellés des groupes pour les lignes d'entreprise (seulement quand la campagne en a plusieurs). */
export function groupLabels(groups: Groups) {
  if (groups.list.length < 2) {
    return null;
  }

  return new Map(groups.list.map((group) => [group.key, group.label]));
}

export function CampaignGroups(props: {
  campaignId: string;
  /** liste des campagnes de l'équipe (lien de secours vers les campagnes créées) */
  campaignsPath: string;
  groups: Groups;
  /** clé React Query de fetchCampaignLive, mise à jour tout de suite après un choix */
  queryKey: unknown[];
}) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { groups } = props;
  // campagnes créées pendant cette visite (avec leurs identifiants, renvoyés par la fonction SQL)
  const [created, setCreated] = useState<CreatedCampaign[] | null>(null);

  const setLocalChoice = (choice: Groups['choice']) => {
    queryClient.setQueryData<CampaignLive>(props.queryKey, (current) =>
      current ? { ...current, groups: { ...current.groups, choice } } : current,
    );

    void queryClient.invalidateQueries({ queryKey: props.queryKey });
  };

  const choose = useAction(setGroupsChoiceAction, {
    onSuccess: ({ data }) => setLocalChoice(data?.choice ?? null),
    onError: ({ error }) => {
      toast.error(
        t(error.serverError ?? 'campaigns.companies.groups.choiceFailed'),
      );
    },
  });

  const split = useAction(splitCampaignByGroupsAction, {
    onSuccess: ({ data }) => {
      setCreated(data?.campaigns ?? []);
      setLocalChoice('split');
    },
    onError: ({ error }) => {
      toast.error(
        t(error.serverError ?? 'campaigns.companies.groups.splitFailed'),
      );
    },
  });

  const count = groups.list.length;
  const busy = choose.isPending || split.isPending;

  // pas de groupes (proposés seuls après une centaine d'entreprises gardées) : rien à afficher
  if (count === 0) {
    return null;
  }

  // campagne créée à partir d'un groupe : un seul groupe, déjà réparti
  if (count === 1) {
    return groups.choice === 'split' ? (
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'campaign-groups-child'}
      >
        <Trans
          i18nKey={'campaigns.companies.groups.childLine'}
          values={{ label: groups.list[0]?.label ?? '' }}
        />
      </p>
    ) : null;
  }

  if (groups.choice === 'split') {
    return created ? (
      <CreatedNow campaigns={created} campaignsPath={props.campaignsPath} />
    ) : (
      <CreatedEarlier
        campaignId={props.campaignId}
        campaignsPath={props.campaignsPath}
        labels={groups.list.map((group) => group.label)}
      />
    );
  }

  if (groups.choice === 'single') {
    return (
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'campaign-groups-single'}
      >
        <Trans
          i18nKey={'campaigns.companies.groups.singleLine'}
          values={{ count }}
        />{' '}
        <span aria-hidden>·</span>{' '}
        <Button
          variant={'link'}
          className={'text-brand h-auto p-0 align-baseline text-sm'}
          loading={choose.isPending}
          data-test={'campaign-groups-change'}
          onClick={() =>
            choose.execute({ campaignId: props.campaignId, choice: null })
          }
        >
          <Trans i18nKey={'campaigns.companies.groups.change'} />
        </Button>
      </p>
    );
  }

  if (!shouldPropose(groups)) {
    return null;
  }

  return (
    <section
      className={
        'bg-brand-pale/60 flex flex-col gap-3 rounded-lg px-4 py-3 md:flex-row md:items-center md:justify-between'
      }
      data-test={'campaign-groups'}
    >
      <div className={'flex min-w-0 flex-col gap-2'}>
        <div className={'flex flex-col gap-0.5'}>
          <p className={'text-sm font-medium'}>
            <Trans
              i18nKey={'campaigns.companies.groups.title'}
              values={{ count }}
            />
          </p>

          <p className={'text-muted-foreground text-sm'}>
            <Trans i18nKey={'campaigns.companies.groups.description'} />
          </p>
        </div>

        <ul className={'flex flex-wrap gap-1.5'}>
          {groups.list.map((group) => (
            <li key={group.key}>
              <Badge
                variant={'outline'}
                className={'bg-background'}
                data-test={'campaign-group'}
              >
                {group.label}
                <span className={'text-muted-foreground tabular-nums'}>
                  <Trans
                    i18nKey={'campaigns.companies.groups.kept'}
                    values={{ count: group.kept }}
                  />
                </span>
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className={'flex shrink-0 flex-wrap items-center gap-2'}>
        <Button
          size={'sm'}
          variant={'outline'}
          disabled={busy}
          loading={choose.isPending}
          data-test={'campaign-groups-single-button'}
          onClick={() =>
            choose.execute({ campaignId: props.campaignId, choice: 'single' })
          }
        >
          <Trans i18nKey={'campaigns.companies.groups.single'} />
        </Button>

        <Button
          size={'sm'}
          disabled={busy}
          loading={split.isPending}
          data-test={'campaign-groups-split'}
          onClick={() => split.execute({ campaignId: props.campaignId })}
        >
          <Trans
            i18nKey={'campaigns.companies.groups.split'}
            values={{ count }}
          />
        </Button>
      </div>
    </section>
  );
}

/** Juste après « Créer N campagnes » : les campagnes créées, chacune avec un lien vers son message. */
function CreatedNow(props: {
  campaigns: CreatedCampaign[];
  campaignsPath: string;
}) {
  return (
    <section
      className={'bg-brand-pale/60 flex flex-col gap-2 rounded-lg px-4 py-3'}
      data-test={'campaign-groups-created'}
    >
      <div className={'flex flex-col gap-0.5'}>
        <p className={'text-sm font-medium'}>
          <Trans
            i18nKey={'campaigns.companies.groups.createdTitle'}
            values={{ count: props.campaigns.length }}
          />
        </p>

        <p className={'text-muted-foreground text-sm'}>
          <Trans i18nKey={'campaigns.companies.groups.createdDescription'} />
        </p>
      </div>

      <ul className={'flex flex-col gap-1'}>
        {props.campaigns.map((campaign) => (
          <li key={campaign.id} className={'text-sm'}>
            <Link
              href={writeHref(props.campaignsPath, campaign.id)}
              className={'text-brand inline-flex items-center gap-1'}
              data-test={'campaign-groups-created-link'}
            >
              {campaign.label}
              <ArrowRight className={'size-3.5'} />
            </Link>{' '}
            <span className={'text-muted-foreground'}>
              <Trans
                i18nKey={'campaigns.companies.groups.companies'}
                values={{ count: campaign.companies }}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Plus tard (page rechargée) : ligne discrète « Campagnes créées par groupe : … ». Les identifiants ne sont pas
 * gardés en base : on retrouve les campagnes par leur nom (« nom de la campagne · groupe », donné à la création) ;
 * si elles ont été renommées ou ne se retrouvent pas, une simple mention et un lien vers la liste des campagnes.
 */
function CreatedEarlier(props: {
  campaignId: string;
  campaignsPath: string;
  labels: string[];
}) {
  const client = useSupabase();

  const query = useQuery({
    queryKey: ['lm-group-campaigns', props.campaignId, props.labels],
    queryFn: () =>
      fetchGroupCampaigns(client, {
        campaignId: props.campaignId,
        labels: props.labels,
      }),
    staleTime: 60_000,
  });

  const found = query.data ?? [];

  if (query.isPending) {
    return null;
  }

  return (
    <p
      className={'text-muted-foreground text-sm'}
      data-test={'campaign-groups-split-line'}
    >
      {found.length > 0 ? (
        <>
          <Trans i18nKey={'campaigns.companies.groups.splitLine'} />{' '}
          {found.map((campaign, index) => (
            <span key={campaign.id}>
              {index > 0 ? (
                <>
                  {' '}
                  <span aria-hidden>·</span>{' '}
                </>
              ) : null}
              <Link
                href={writeHref(props.campaignsPath, campaign.id)}
                className={'text-brand whitespace-nowrap'}
              >
                {campaign.label}
              </Link>
            </span>
          ))}
        </>
      ) : (
        <Trans
          i18nKey={'campaigns.companies.groups.splitLineFallback'}
          components={{
            link: (chunks: React.ReactNode) => (
              <Link className={'text-brand'} href={props.campaignsPath}>
                {chunks}
              </Link>
            ),
          }}
        />
      )}
    </p>
  );
}

/** Étape « Votre message » d'une campagne créée par groupe : chacune a son propre message. */
function writeHref(campaignsPath: string, campaignId: string) {
  return `${campaignsPath}/${campaignId}?etape=rediger`;
}

/**
 * Campagnes créées par groupe depuis une campagne : même dossier, nommées « nom de la campagne · groupe »
 * (lm_split_campaign_by_groups). La plus récente l'emporte si plusieurs portent le même nom.
 */
async function fetchGroupCampaigns(
  client: SupabaseClient<Database>,
  params: { campaignId: string; labels: string[] },
) {
  const source = await client
    .from('lm_campaigns')
    .select('name, space_id')
    .eq('id', params.campaignId)
    .single();

  if (source.error) {
    throw source.error;
  }

  const byName = new Map(
    params.labels.map((label) => [
      `${source.data.name} · ${label}`.slice(0, 255),
      label,
    ]),
  );

  const { data, error } = await client
    .from('lm_campaigns')
    .select('id, name')
    .eq('space_id', source.data.space_id)
    .neq('id', params.campaignId)
    .in('name', [...byName.keys()])
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const found = new Map<string, { id: string; label: string }>();

  for (const row of data ?? []) {
    const label = byName.get(row.name);

    if (label !== undefined && !found.has(label)) {
      found.set(label, { id: row.id, label });
    }
  }

  // dans l'ordre des groupes
  return params.labels.flatMap((label) => found.get(label) ?? []);
}
