import { getFormatter, getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

type UsageRow = {
  day: string;
  campaignName: string | null;
  discoveryUsed: number;
  outreachUsed: number;
  discoveryAdded: number;
  outreachAdded: number;
};

/**
 * Soldes, date de renouvellement et consommation des 30 derniers jours (audit E12, E23), sur la page
 * Facturation. Données : lm_account_credits et lm_credit_usage (journal agrégé par jour et campagne).
 * Si la fonction n'existe pas encore en base, seuls les soldes sont affichés.
 */
export async function CreditUsageCard(props: { accountId: string }) {
  const client = getSupabaseServerClient();
  const t = await getTranslations('billing.usage');
  const format = await getFormatter();

  const [credits, usage] = await Promise.all([
    client
      .from('lm_account_credits')
      .select(
        'discovery_balance, outreach_balance, period_ends_at, next_refill_at, plan:lm_plans(discovery_credits, outreach_credits)',
      )
      .eq('account_id', props.accountId)
      .maybeSingle(),
    client.rpc('lm_credit_usage', {
      p_account_id: props.accountId,
      p_days: 30,
    }),
  ]);

  const balance = credits.data;
  const plan = balance?.plan ?? null;
  const renewal = balance?.next_refill_at ?? balance?.period_ends_at ?? null;

  // une ligne par jour et par campagne ; les recharges du forfait (sans campagne) à part
  const rows = new Map<string, UsageRow>();

  for (const row of usage.data ?? []) {
    const key = `${row.day}|${row.campaign_id ?? ''}`;
    const current = rows.get(key) ?? {
      day: row.day,
      campaignName: row.campaign_name,
      discoveryUsed: 0,
      outreachUsed: 0,
      discoveryAdded: 0,
      outreachAdded: 0,
    };

    if (row.kind === 'discovery') {
      current.discoveryUsed += row.used;
      current.discoveryAdded += row.added;
    } else {
      current.outreachUsed += row.used;
      current.outreachAdded += row.added;
    }
    rows.set(key, current);
  }

  const lines = [...rows.values()];

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
        <div
          className={
            'grid divide-y overflow-hidden rounded-xl border sm:grid-cols-2 sm:divide-x sm:divide-y-0'
          }
        >
          <Balance
            label={t('discovery')}
            value={balance?.discovery_balance ?? 0}
            max={plan?.discovery_credits ?? null}
            format={format}
            ofLabel={t('of')}
          />
          <Balance
            label={t('outreach')}
            value={balance?.outreach_balance ?? 0}
            max={plan?.outreach_credits ?? null}
            format={format}
            ofLabel={t('of')}
          />
        </div>

        {usage.error ? null : lines.length === 0 ? (
          <p className={'text-muted-foreground text-sm'}>{t('empty')}</p>
        ) : (
          <Table data-test={'credit-usage-table'}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dateColumn')}</TableHead>
                <TableHead>{t('campaignColumn')}</TableHead>
                <TableHead className={'text-right'}>
                  {t('discoveryColumn')}
                </TableHead>
                <TableHead className={'text-right'}>
                  {t('outreachColumn')}
                </TableHead>
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
                    {line.campaignName ??
                      (line.discoveryAdded + line.outreachAdded > 0
                        ? t('refill')
                        : t('other'))}
                  </TableCell>
                  <TableCell className={'text-right tabular-nums'}>
                    {movement(line.discoveryUsed, line.discoveryAdded, format)}
                  </TableCell>
                  <TableCell className={'text-right tabular-nums'}>
                    {movement(line.outreachUsed, line.outreachAdded, format)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
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
  format: Awaited<ReturnType<typeof getFormatter>>;
}) {
  // jauge façon ElevenLabs : étiquette, grand chiffre, barre de progression
  const ratio = props.max
    ? Math.max(0, Math.min(1, props.value / props.max))
    : null;

  return (
    <div className={'flex flex-col gap-2 px-5 py-4'}>
      <p className={'text-muted-foreground text-[13px] font-medium'}>
        {props.label}
      </p>

      <p className={'font-display text-[1.75rem] tracking-tight tabular-nums'}>
        {props.format.number(props.value)}
        {props.max ? (
          <span className={'text-muted-foreground text-sm font-normal'}>
            {' '}
            {props.ofLabel} {props.format.number(props.max)}
          </span>
        ) : null}
      </p>

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
