/**
 * Rôle : en-tête de 48 px présent sur toutes les pages de l'organisation (relooking du 8/11/2026,
 * façon ElevenLabs) — bouton pour replier la barre latérale, fil d'Ariane, accès à la recherche,
 * crédits restants, notifications et menu du compte.
 * Données : workspace (passé par le layout) ; solde de crédits (loadDiscoveryBalance) derrière un Suspense.
 * Écritures : aucune.
 */
import { Suspense } from 'react';

import Link from 'next/link';

import { Search } from 'lucide-react';
import { getFormatter } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageSidebarTrigger } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';
import pathsConfig from '~/config/paths.config';

import { loadDiscoveryBalance } from '../_lib/server/leadmaker.loader';
import type { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { TeamAccountNotifications } from './team-account-notifications';

type Workspace = Awaited<ReturnType<typeof loadTeamWorkspace>>;

export function TeamAccountTopBar(props: {
  account: string;
  workspace: Workspace;
}) {
  const prospectsPath = pathsConfig.app.accountProspects.replace(
    '[account]',
    props.account,
  );

  const billingPath = pathsConfig.app.accountBilling.replace(
    '[account]',
    props.account,
  );

  return (
    <header
      className={
        'bg-background/95 supports-[backdrop-filter]:bg-background/85 sticky top-0 z-20 hidden h-12 shrink-0 items-center gap-3 border-b px-3 backdrop-blur-md lg:flex'
      }
      data-test={'team-top-bar'}
    >
      <PageSidebarTrigger
        className={'text-muted-foreground hover:text-foreground'}
      />

      <div className={'min-w-0 flex-1'}>
        <AppBreadcrumbs />
      </div>

      <Link
        href={prospectsPath}
        className={
          'text-muted-foreground hover:bg-muted hover:text-foreground ring-border hidden h-8 w-72 items-center gap-2 rounded-lg px-3 text-[13px] ring-1 transition-colors xl:flex'
        }
        data-test={'top-bar-search'}
      >
        <Search className={'size-3.5'} />
        <span className={'truncate'}>
          <Trans i18nKey={'common.topBar.search'} />
        </span>
      </Link>

      <div className={'flex flex-1 items-center justify-end gap-1.5'}>
        <Suspense fallback={null}>
          <CreditsPill
            accountId={props.workspace.account.id}
            billingPath={billingPath}
          />
        </Suspense>

        <TeamAccountNotifications
          userId={props.workspace.user.id}
          accountId={props.workspace.account.id}
        />

        <ProfileAccountDropdownContainer
          user={props.workspace.user}
          accountSlug={props.account}
          showProfileName={false}
        />
      </div>
    </header>
  );
}

async function CreditsPill(props: { accountId: string; billingPath: string }) {
  const [balance, format] = await Promise.all([
    loadDiscoveryBalance(getSupabaseServerClient(), props.accountId),
    getFormatter(),
  ]);

  return (
    <Link
      href={props.billingPath}
      className={
        'ring-border hover:bg-muted hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium tabular-nums ring-1 transition-colors md:flex'
      }
      data-test={'top-bar-credits'}
    >
      <span className={'bg-brand size-1.5 rounded-full'} aria-hidden />
      <Trans
        i18nKey={'common.topBar.credits'}
        values={{ count: format.number(balance) }}
      />
    </Link>
  );
}
