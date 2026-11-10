'use client';

/**
 * Rôle : recherche + pastilles de statut + tableau de la page Campagnes, filtrés dans le navigateur
 * (10/11/2026, « ça ne filtre pas de façon instantanée ») : toutes les campagnes de l'organisation sont déjà
 * chargées (quelques dizaines au plus), on filtre à chaque lettre tapée et à chaque clic, sans rappeler le
 * serveur. L'adresse (?q=, ?statut=) est mise à jour en silence pour garder un lien partageable.
 * Écritures : aucune.
 */
import { useState } from 'react';

import Link from 'next/link';

import { ArrowRight, Search } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import type { Database } from '~/lib/database.types';

import { CampaignStatusBadge } from '../../_components/leadmaker/campaign-status-badge';
import { STATUS_FILTERS } from '../_lib/status-filters';

type CampaignStatus = Database['public']['Enums']['lm_campaign_status'];

export interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  createdLabel: string;
  folderLabel: string;
  countryLabel: string;
  prospectsLabel: string;
}

export function CampaignsTable(props: {
  campaigns: CampaignRow[];
  campaignsPath: string;
  showFolders: boolean;
  initialSearch: string;
  initialStatus: CampaignStatus | null;
  searchPlaceholder: string;
  openLabel: string;
}) {
  const [filters, setFilters] = useState({
    search: props.initialSearch,
    status: props.initialStatus,
  });

  const update = (next: Partial<typeof filters>) => {
    const merged = { ...filters, ...next };
    setFilters(merged);

    // lien partageable, sans recharger la page
    const params = new URLSearchParams();
    if (merged.status) params.set('statut', merged.status);
    if (merged.search.trim()) params.set('q', merged.search.trim());
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      qs ? `${props.campaignsPath}?${qs}` : props.campaignsPath,
    );
  };

  const search = filters.search.trim().toLocaleLowerCase();

  // sans filtre : tout sauf les archivées
  const campaigns = props.campaigns.filter(
    (campaign) =>
      (filters.status
        ? campaign.status === filters.status
        : campaign.status !== 'archived') &&
      (!search || campaign.name.toLocaleLowerCase().includes(search)),
  );

  const countByStatus = (status: CampaignStatus) =>
    props.campaigns.filter((campaign) => campaign.status === status).length;

  const visibleCount = props.campaigns.filter(
    (campaign) => campaign.status !== 'archived',
  ).length;

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex flex-wrap items-center gap-2'}>
        <form
          className={'relative w-full sm:w-72'}
          role={'search'}
          onSubmit={(event) => event.preventDefault()}
        >
          <Search
            className={
              'text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2'
            }
          />

          <Input
            name={'q'}
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
            placeholder={props.searchPlaceholder}
            className={'h-8 rounded-full pl-10 text-[14px]'}
            data-test={'campaigns-search'}
            autoComplete={'off'}
          />
        </form>

        <div className={'flex flex-wrap items-center gap-1.5'}>
          <StatusChip
            active={!filters.status}
            count={visibleCount}
            label={<Trans i18nKey={'campaigns.list.filterAll'} />}
            testId={'campaigns-filter-all'}
            onClick={() => update({ status: null })}
          />

          {STATUS_FILTERS.map((status) => (
            <StatusChip
              key={status}
              active={filters.status === status}
              count={countByStatus(status)}
              label={<Trans i18nKey={`campaigns.status.${status}`} />}
              testId={
                status === 'archived'
                  ? 'campaigns-archived-toggle'
                  : `campaigns-filter-${status}`
              }
              onClick={() => update({ status })}
            />
          ))}
        </div>
      </div>

      <Card className={'gap-0 py-0'}>
        {campaigns.length === 0 ? (
          <p
            className={'text-muted-foreground px-4 py-12 text-center text-sm'}
            data-test={'campaigns-empty'}
          >
            <Trans
              i18nKey={
                filters.status === 'archived' && !search
                  ? 'campaigns.archive.listEmpty'
                  : 'campaigns.list.emptyFiltered'
              }
            />
          </p>
        ) : (
          <Table data-test={'campaigns-table'}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans i18nKey={'campaigns.list.nameColumn'} />
                </TableHead>

                <TableHead>
                  <Trans i18nKey={'campaigns.list.statusColumn'} />
                </TableHead>

                {props.showFolders ? (
                  <TableHead>
                    <Trans i18nKey={'campaigns.list.folderColumn'} />
                  </TableHead>
                ) : null}

                <TableHead>
                  <Trans i18nKey={'campaigns.list.countryColumn'} />
                </TableHead>

                <TableHead className={'text-right'}>
                  <Trans i18nKey={'campaigns.list.prospectsColumn'} />
                </TableHead>

                <TableHead className={'w-12'} />
              </TableRow>
            </TableHeader>

            <TableBody>
              {campaigns.map((campaign) => {
                const href = `${props.campaignsPath}/${campaign.id}`;

                return (
                  <TableRow
                    key={campaign.id}
                    className={'group/row [&>td]:h-14'}
                  >
                    <TableCell className={'max-w-[28rem]'}>
                      <Link
                        className={'flex min-w-0 flex-col'}
                        data-test={'campaign-link'}
                        href={href}
                      >
                        <span className={'truncate text-[15px] font-medium'}>
                          {campaign.name}
                        </span>

                        <span
                          className={
                            'text-muted-foreground truncate text-[14px]'
                          }
                        >
                          {campaign.createdLabel}
                        </span>
                      </Link>
                    </TableCell>

                    <TableCell>
                      <CampaignStatusBadge status={campaign.status} />
                    </TableCell>

                    {props.showFolders ? (
                      <TableCell className={'text-muted-foreground'}>
                        {campaign.folderLabel}
                      </TableCell>
                    ) : null}

                    <TableCell className={'text-muted-foreground'}>
                      {campaign.countryLabel}
                    </TableCell>

                    <TableCell className={'text-right tabular-nums'}>
                      {campaign.prospectsLabel}
                    </TableCell>

                    <TableCell className={'text-right'}>
                      <Button
                        variant={'ghost'}
                        size={'icon-sm'}
                        nativeButton={false}
                        aria-label={props.openLabel}
                        className={
                          'text-muted-foreground group-hover/row:text-foreground'
                        }
                        render={<Link href={href} />}
                      >
                        <ArrowRight />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div
          className={
            'text-muted-foreground flex items-center justify-between border-t px-4 py-2.5 text-[14px]'
          }
        >
          <span>
            <Trans
              i18nKey={'campaigns.list.count'}
              values={{ count: campaigns.length }}
            />
          </span>
        </div>
      </Card>
    </div>
  );
}

/** Pastille de filtre (même dessin que FilterChip), en bouton : filtre sur place. */
function StatusChip(props: {
  active: boolean;
  label: React.ReactNode;
  count: number;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type={'button'}
      onClick={props.onClick}
      aria-pressed={props.active}
      data-test={props.testId}
      className={cn(
        'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] font-medium whitespace-nowrap transition-colors',
        props.active
          ? 'bg-brand-pale text-brand-hover dark:text-brand'
          : 'bg-card text-foreground ring-pill-ring shadow-soft hover:bg-muted ring-[0.5px]',
      )}
    >
      <span>{props.label}</span>

      <span
        className={cn(
          'text-xs tabular-nums',
          props.active ? 'opacity-70' : 'text-muted-foreground',
        )}
      >
        {props.count}
      </span>
    </button>
  );
}
