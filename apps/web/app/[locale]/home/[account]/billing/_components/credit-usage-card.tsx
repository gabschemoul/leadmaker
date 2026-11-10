import { Suspense } from 'react';

import { connection } from 'next/server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getFormatter, getTranslations } from 'next-intl/server';

import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Trans } from '@kit/ui/trans';

type UsageRow = {
  day: string;
  campaignName: string | null;
  used: number;
  added: number;
};

/**
 * Solde, date de renouvellement et consommation des 30 derniers jours (audit E12, E23), sur la page
 * Facturation. Données : lm_account_credits et lm_credit_usage (journal agrégé par jour et campagne).
 * Crédit unique (9/11) : seul le solde `discovery_balance` (type 'discovery') compte ; l'ancien solde
 * de prise de contact n'est plus ni affiché ni débité. Si la fonction n'existe pas encore en base,
 * seul le solde est affiché.
 * Packs de crédits (10/11) : quand l'organisation en a, le solde du forfait et celui des packs (avec la
 * prochaine expiration) sont montrés côte à côte, avec le total disponible (lm_available_credits).
 */
export async function CreditUsageCard(props: { accountId: string }) {
  const client = getSupabaseServerClient();
  const t = await getTranslations('billing.usage');
  const format = await getFormatter();

  const [credits, packRows, available] = await Promise.all([
    client
      .from('lm_account_credits')
      .select(
        'discovery_balance, period_ends_at, next_refill_at, plan:lm_plans(discovery_credits)',
      )
      .eq('account_id', props.accountId)
      .maybeSingle(),
    loadActivePacks(client, props.accountId),
    client.rpc('lm_available_credits', { p_account_id: props.accountId }),
  ]);

  const balance = credits.data;
  const plan = balance?.plan ?? null;
  const renewal = balance?.next_refill_at ?? balance?.period_ends_at ?? null;
  const planBalance = balance?.discovery_balance ?? 0;

  const packs = packRows.data ?? [];
  const packCredits = packs.reduce((sum, pack) => sum + pack.remaining, 0);
  const nextExpiry = packs[0]?.expires_at ?? null;
  const total = available.data ?? planBalance + packCredits;

  return (
    <Card data-test={'credit-usage-card'}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {renewal
            ? t('renewal', {
                date: format.dateTime(new Date(renewal), { dateStyle: 'long' }),
              })
            : t('noRenewal')}
        </CardDescription>
      </CardHeader>

      <CardContent className={'flex flex-col gap-6'}>
        {packCredits > 0 ? (
          <div className={'flex flex-col gap-2'}>
            <p className={'text-sm'} data-test={'credit-usage-total'}>
              {t('total', { count: format.number(total) })}
            </p>

            <div
              className={
                'grid overflow-hidden rounded-xl border sm:grid-cols-2 sm:divide-x'
              }
            >
              <Balance
                label={t('planBalance')}
                value={planBalance}
                max={plan?.discovery_credits ?? null}
                format={format}
                ofLabel={t('of')}
              />

              <Balance
                label={t('packBalance')}
                value={packCredits}
                max={null}
                format={format}
                ofLabel={t('of')}
                hint={
                  nextExpiry
                    ? t('packExpiry', {
                        date: format.dateTime(new Date(nextExpiry), {
                          dateStyle: 'long',
                        }),
                      })
                    : null
                }
              />
            </div>
          </div>
        ) : (
          <div className={'overflow-hidden rounded-xl border'}>
            <Balance
              label={t('balance')}
              value={total}
              max={plan?.discovery_credits ?? null}
              format={format}
              ofLabel={t('of')}
            />
          </div>
        )}

        {/* consommation : envoyée après le solde, elle ne le retarde pas (10/11/2026) */}
        <Suspense fallback={<UsageTableLoading />}>
          <CreditUsageTable accountId={props.accountId} />
        </Suspense>
      </CardContent>
    </Card>
  );
}

/** Packs de crédits encore utilisables, du plus proche de son expiration au plus lointain (RLS : membres). */
async function loadActivePacks(
  client: SupabaseClient<Database>,
  accountId: string,
) {
  // l'heure de la requête : lecture par requête, jamais pré-rendue
  await connection();

  return client
    .from('lm_credit_packs')
    .select('remaining, expires_at')
    .eq('account_id', accountId)
    .gt('remaining', 0)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true });
}

/** « −120 », « +30 000 », les deux, ou « — ». */
function movement(
  used: number,
  added: number,
  format: Awaited<ReturnType<typeof getFormatter>>,
) {
  const parts = [
    added > 0 ? `+${format.number(added)}` : null,
    used > 0 ? `−${format.number(used)}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : '—';
}

function Balance(props: {
  label: string;
  value: number;
  max: number | null;
  ofLabel: string;
  hint?: string | null;
  format: Awaited<ReturnType<typeof getFormatter>>;
}) {
  // jauge façon ElevenLabs : étiquette, grand chiffre, barre de progression
  const ratio = props.max
    ? Math.max(0, Math.min(1, props.value / props.max))
    : null;

  return (
    <div className={'flex flex-col gap-2 px-5 py-4'}>
      <p className={'text-muted-foreground text-[14px] font-medium'}>
        {props.label}
      </p>

      <p className={'font-display text-[1.75rem] font-medium'}>
        {props.format.number(props.value)}
        {props.max ? (
          <span className={'text-muted-foreground text-sm font-normal'}>
            {' '}
            {props.ofLabel} {props.format.number(props.max)}
          </span>
        ) : null}
      </p>

      {props.hint ? (
        <p className={'text-muted-foreground text-sm'}>{props.hint}</p>
      ) : null}

      {ratio !== null ? (
        <div
          className={'bg-muted h-1.5 w-full overflow-hidden rounded-full'}
          role={'progressbar'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
        >
          <div
            className={'bg-brand h-full rounded-full'}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Consommation des 30 derniers jours, par jour et par campagne (lm_credit_usage). */
async function CreditUsageTable(props: { accountId: string }) {
  const client = getSupabaseServerClient();
  const t = await getTranslations('billing.usage');
  const format = await getFormatter();

  const usage = await client.rpc('lm_credit_usage', {
    p_account_id: props.accountId,
    p_days: 30,
  });

  // une ligne par jour et par campagne ; les recharges du forfait (sans campagne) à part
  const rows = new Map<string, UsageRow>();

  for (const row of usage.data ?? []) {
    // anciens mouvements « prise de contact » : plus un solde, on ne les montre pas
    if (row.kind !== 'discovery') continue;

    const key = `${row.day}|${row.campaign_id ?? ''}`;
    const current = rows.get(key) ?? {
      day: row.day,
      campaignName: row.campaign_name,
      used: 0,
      added: 0,
    };

    current.used += row.used;
    current.added += row.added;
    rows.set(key, current);
  }

  const lines = [...rows.values()];

  if (usage.error) {
    return null;
  }

  return lines.length === 0 ? (
    <p className={'text-muted-foreground text-sm'}>{t('empty')}</p>
  ) : (
    <Table data-test={'credit-usage-table'}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('dateColumn')}</TableHead>
          <TableHead>{t('campaignColumn')}</TableHead>
          <TableHead className={'text-right'}>{t('creditsColumn')}</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {lines.map((line) => (
          <TableRow key={`${line.day}-${line.campaignName ?? ''}`}>
            <TableCell>
              {format.dateTime(new Date(line.day), {
                dateStyle: 'medium',
              })}
            </TableCell>
            <TableCell>
              {line.campaignName ?? (line.added > 0 ? t('refill') : t('other'))}
            </TableCell>
            <TableCell className={'text-right tabular-nums'}>
              {movement(line.used, line.added, format)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Tableau de consommation pendant son chargement : vrais titres de colonnes, lignes en silhouette. */
function UsageTableLoading() {
  return (
    <Table aria-busy={true}>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans i18nKey={'billing.usage.dateColumn'} />
          </TableHead>
          <TableHead>
            <Trans i18nKey={'billing.usage.campaignColumn'} />
          </TableHead>
          <TableHead className={'text-right'}>
            <Trans i18nKey={'billing.usage.creditsColumn'} />
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {Array.from({ length: 4 }).map((_, index) => (
          <TableRow key={index}>
            <TableCell>
              <Skeleton className={'h-4 w-24'} />
            </TableCell>
            <TableCell>
              <Skeleton className={'h-4 w-40'} />
            </TableCell>
            <TableCell>
              <Skeleton className={'ml-auto h-4 w-16'} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
