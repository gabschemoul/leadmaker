'use client';

/**
 * Rôle : section « En direct » du pilote automatique (refaite le 11/11/2026 d'après la maquette validée par
 * Gabriel) : les derniers messages envoyés en cartes (clic = détail de l'envoi, « Voir les N envois » = la liste
 * complète), le bilan des sites visités par raison et la prévision de fin d'envoi avec le rythme des dernières
 * heures. 12/11 : plus de mode Avancé, le bilan n'est plus cliquable (ce qui attend l'utilisateur est dans
 * « À vous de jouer »).
 * Données : fetchAutopilotLive / fetchAutopilotSent (lm_attempts du passage, lus par la RLS), relus toutes les
 * quelques secondes en marche.
 * Écritures : aucune.
 */
import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Button } from '@kit/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@kit/ui/sheet';
import { Spinner } from '@kit/ui/spinner';
import { cn } from '@kit/ui/utils';

import {
  type AutopilotSentCard,
  displayHost,
  fetchAttemptScreenshot,
  fetchAutopilotLive,
  countCampaignSent,
  fetchCampaignSent,
} from '~/lib/leadmaker/autopilot-query';

/** Relecture en marche (même rythme que les compteurs). */
const POLL_MS = 4000;

/** Couleurs des pastilles des cartes, choisies d'après le nom (toujours la même pour une entreprise). */
const TINTS = [
  '#3d3dff',
  '#7a4cff',
  '#157a40',
  '#c2410c',
  '#0e7490',
  '#be185d',
];

/** Issues d'un site visité, dans l'ordre du bilan, avec leur couleur (maquette du 12/11). */
const OUTCOMES = [
  { key: 'sent', color: '#157a40' },
  { key: 'todo', color: '#3d3dff' },
  { key: 'quoteOnly', color: '#8b8bff' },
  { key: 'noForm', color: '#c8c8ff' },
  { key: 'unreachable', color: '#d6d3cd' },
  { key: 'other', color: '#a8a49f' },
] as const;

/** Envois chargés à chaque « Voir plus » de la liste complète. */
const SENT_PAGE = 50;

export function AutopilotLive(props: {
  autopilotId: string;
  campaignId: string;
  live: boolean;
  target: number;
  sentCount: number;
  schedule: string | null;
  spreadDays: number | null;
  timezone: string | null;
  startedAt: string | null;
  /** expéditeur en clair (« Prénom Nom · Société ») */
  senderLabel: string | null;
}) {
  const t = useTranslations('campaigns.autopilot.live');
  const format = useFormatter();
  const locale = useLocale();
  const client = useSupabase();
  // envois de toute la campagne (tous les passages du pilote) : la liste garde les anciens lots
  const { data: campaignSent = props.sentCount } = useQuery({
    queryKey: ['lm-campaign-sent-count', props.campaignId],
    queryFn: () => countCampaignSent(client, props.campaignId),
    refetchInterval: props.live ? POLL_MS * 3 : false,
  });
  const [open, setOpen] = useState<AutopilotSentCard | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['lm-autopilot-live', props.autopilotId, locale],
    queryFn: () => fetchAutopilotLive(client, props.autopilotId, locale),
    enabled: Boolean(props.autopilotId),
    refetchInterval: props.live ? POLL_MS : false,
  });

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // « à l'instant », « il y a 12 s », « il y a 3 min », puis l'heure
  const ago = (date: Date) => {
    const seconds = Math.max(
      0,
      Math.round(((dataUpdatedAt || 0) - date.getTime()) / 1000),
    );

    if (seconds < 5) return t('ago.now');
    if (seconds < 60) return t('ago.seconds', { count: seconds });
    if (seconds < 3600)
      return t('ago.minutes', { count: Math.floor(seconds / 60) });

    return format.dateTime(date, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    });
  };

  // « aujourd'hui vers 16:30 », « demain », sinon « mardi 18 novembre »
  const whenLabel = (end: Date) => {
    const day = (date: Date) =>
      format.dateTime(date, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        timeZone: zone,
      });
    const now = new Date(dataUpdatedAt || 0);

    if (day(end) === day(now)) {
      return t('today', {
        time: format.dateTime(end, {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: zone,
        }),
      });
    }

    if (day(end) === day(new Date(now.getTime() + 86_400_000))) {
      return t('tomorrow');
    }

    return format.dateTime(end, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: zone,
    });
  };

  const cards = data?.sent ?? [];
  const outcomes = data?.outcomes;
  const breakdown = OUTCOMES.map((outcome) => ({
    ...outcome,
    count: outcomes?.[outcome.key] ?? 0,
  })).filter((outcome) => outcome.count > 0);
  const visited = breakdown.reduce((sum, item) => sum + item.count, 0);
  const sentTimes = data?.sentTimes ?? [];

  const forecast = forecastEnd({
    sentTimes,
    now: dataUpdatedAt || 0,
    target: props.target,
    sent: props.sentCount,
    schedule: props.schedule,
    spreadDays: props.spreadDays,
    timezone: props.timezone,
    startedAt: props.startedAt,
  });

  return (
    <div className={'flex flex-col gap-4'} data-test={'autopilot-live'}>
      <section
        className={
          'bg-card ring-foreground/10 flex flex-col gap-4 rounded-2xl p-5 ring-1'
        }
        data-test={'autopilot-sent-cards'}
      >
        <div className={'flex items-baseline justify-between gap-3'}>
          <h3 className={'flex items-center gap-2 text-[15px] font-medium'}>
            {t('sentTitle')}
            {props.live ? (
              <span
                aria-hidden
                className={'bg-ok size-1.5 animate-pulse rounded-full'}
              />
            ) : null}
          </h3>

          {campaignSent > 0 ? (
            <button
              type={'button'}
              className={'text-brand cursor-pointer text-sm hover:underline'}
              data-test={'autopilot-see-all-sent'}
              onClick={() => setListOpen(true)}
            >
              {t('seeAllSent', { count: campaignSent })}
            </button>
          ) : null}
        </div>

        {cards.length === 0 ? (
          <p className={'text-muted-foreground text-sm'}>
            {props.live ? t('sentEmptyLive') : t('sentEmpty')}
          </p>
        ) : (
          <ul className={'grid grid-cols-1 gap-3 md:grid-cols-3'}>
            {cards.map((card) => (
              <li key={card.id} className={'min-w-0'}>
                <button
                  type={'button'}
                  className={
                    'bg-card ring-foreground/10 hover:ring-foreground/20 flex h-full w-full cursor-pointer flex-col gap-3.5 rounded-xl p-4 text-left shadow-[0_6px_18px_-12px_rgba(20,20,19,0.25)] ring-1 transition-shadow'
                  }
                  data-test={'autopilot-sent-card'}
                  onClick={() => setOpen(card)}
                >
                  <span className={'flex min-w-0 items-center gap-3'}>
                    <ProspectBadge name={card.prospect.name} />

                    <span className={'flex min-w-0 flex-col'}>
                      <span className={'truncate text-[15px] font-semibold'}>
                        {card.prospect.name}
                      </span>
                      <span
                        className={'text-muted-foreground truncate text-[13px]'}
                      >
                        {[card.activity, card.prospect.city]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </span>

                  <span
                    className={
                      'bg-brand-pale/70 flex min-w-0 flex-col gap-0.5 rounded-xl rounded-bl-sm px-3.5 py-3 text-[13px] leading-snug'
                    }
                  >
                    {card.subject ? (
                      <span className={'truncate font-semibold'}>
                        {card.subject}
                      </span>
                    ) : null}
                    <span className={'text-muted-foreground line-clamp-2'}>
                      {(card.body ?? '').replace(/\s+/g, ' ').trim()}
                    </span>
                  </span>

                  <span
                    className={
                      'mt-auto flex items-center justify-between gap-2 text-xs'
                    }
                  >
                    <span
                      className={
                        'bg-ok-pale text-ok inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-medium'
                      }
                    >
                      <Check className={'size-3'} strokeWidth={2.5} />
                      {t('received')}
                    </span>

                    {card.sent_at ? (
                      <span className={'text-muted-foreground'}>
                        {ago(new Date(card.sent_at))}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div
        className={
          'grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_340px]'
        }
      >
        <section
          className={
            'bg-card ring-foreground/10 flex flex-col gap-4 rounded-2xl p-5 ring-1'
          }
          data-test={'autopilot-breakdown'}
        >
          <h3 className={'text-[15px] font-medium'}>
            {t('visitedTitle', { count: visited })}
          </h3>

          {visited === 0 ? (
            <p className={'text-muted-foreground text-sm'}>
              {t('visitedEmpty')}
            </p>
          ) : (
            <>
              <div
                className={'flex h-3.5 gap-0.5 overflow-hidden rounded-full'}
                aria-hidden
              >
                {breakdown.map((item) => (
                  <span
                    key={item.key}
                    className={'h-full'}
                    style={{
                      flexBasis: `${(item.count / visited) * 100}%`,
                      background: item.color,
                    }}
                  />
                ))}
              </div>

              <ul className={'-mx-2 flex flex-col'}>
                {breakdown.map((item) => (
                  <li
                    key={item.key}
                    className={
                      'flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm'
                    }
                  >
                    <span
                      aria-hidden
                      className={'size-2.5 shrink-0 rounded-[3px]'}
                      style={{ background: item.color }}
                    />
                    <span className={'min-w-0 flex-1 truncate'}>
                      {t(`outcome.${item.key}`)}
                    </span>
                    <span
                      className={
                        'text-muted-foreground w-12 text-right tabular-nums'
                      }
                    >
                      {format.number(item.count)}
                    </span>
                    <span
                      className={
                        'text-muted-foreground w-11 text-right tabular-nums'
                      }
                    >
                      {format.number(item.count / visited, {
                        style: 'percent',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section
          className={
            'bg-brand flex flex-col justify-between gap-5 rounded-2xl p-6 text-white'
          }
          data-test={'autopilot-forecast'}
        >
          <span className={'text-sm text-white/80'}>{t('forecastLabel')}</span>

          <p className={'text-2xl leading-tight font-medium text-white'}>
            {forecast.kind === 'date'
              ? t('forecastDate', {
                  target: format.number(props.target),
                  when: whenLabel(forecast.end),
                })
              : forecast.kind === 'done'
                ? t('forecastDone')
                : t('forecastSoon')}
          </p>

          <div className={'flex flex-col gap-2'}>
            <div className={'flex h-14 items-end gap-1'} aria-hidden>
              {forecast.bars.map((bar, index) => (
                <span
                  key={index}
                  className={'flex-1 rounded-[3px] bg-white'}
                  style={{
                    height: `${Math.max(6, bar * 100)}%`,
                    opacity: index === forecast.bars.length - 1 ? 1 : 0.35,
                  }}
                />
              ))}
            </div>

            {forecast.perHour > 0 ? (
              <span className={'text-sm text-white/85'}>
                {t('pace', {
                  count: Math.max(1, Math.round(forecast.perHour)),
                })}
              </span>
            ) : null}
          </div>
        </section>
      </div>

      <SentList
        open={listOpen}
        campaignId={props.campaignId}
        total={campaignSent}
        live={props.live}
        onOpenChange={setListOpen}
        onPick={setOpen}
      />

      <SentDetail
        card={open}
        senderLabel={props.senderLabel}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

/** Pastille de couleur avec les initiales (aussi dans « À vous de jouer »). */
export function ProspectBadge(props: { name: string; size?: 'lg' }) {
  const initials =
    props.name
      .split(/\s+/)
      .filter((word) => /\p{L}|\d/u.test(word[0] ?? ''))
      .slice(0, 2)
      .map((word) => word[0]!.toLocaleUpperCase())
      .join('') || '?';
  const tint = TINTS[hash(props.name) % TINTS.length];

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl font-semibold text-white',
        props.size === 'lg' ? 'size-13 text-xl' : 'size-11 text-base',
      )}
      style={{ background: tint }}
    >
      {initials}
    </span>
  );
}

/** « Voir les N envois » : tous les messages envoyés du passage, les plus récents d'abord (clic = détail). */
function SentList(props: {
  open: boolean;
  campaignId: string;
  total: number;
  live: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (card: AutopilotSentCard) => void;
}) {
  const t = useTranslations('campaigns.autopilot.live');
  const format = useFormatter();
  const locale = useLocale();
  const client = useSupabase();
  const [limit, setLimit] = useState(SENT_PAGE);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['lm-campaign-sent', props.campaignId, locale, limit],
    queryFn: () => fetchCampaignSent(client, props.campaignId, locale, limit),
    enabled: props.open && Boolean(props.campaignId),
    placeholderData: (previous) => previous,
    refetchInterval: props.open && props.live ? POLL_MS * 3 : false,
  });

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        className={
          'w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]'
        }
        data-test={'autopilot-sent-list'}
      >
        <div className={'flex flex-col gap-4 p-6'}>
          <SheetHeader className={'p-0 pr-8'}>
            <SheetTitle className={'text-xl'}>
              {t('allSentTitle', { count: props.total })}
            </SheetTitle>
          </SheetHeader>

          {rows.length === 0 && isFetching ? (
            <div className={'flex justify-center py-10'}>
              <Spinner />
            </div>
          ) : (
            <ul className={'-mx-2 flex flex-col'}>
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type={'button'}
                    className={
                      'hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-left'
                    }
                    data-test={'autopilot-sent-row'}
                    onClick={() => props.onPick(row)}
                  >
                    <ProspectBadge name={row.prospect.name} />

                    <span className={'flex min-w-0 flex-1 flex-col'}>
                      <span className={'truncate text-sm font-medium'}>
                        {row.prospect.name}
                      </span>
                      <span
                        className={'text-muted-foreground truncate text-[13px]'}
                      >
                        {[row.activity, row.prospect.city]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>

                    {row.sent_at ? (
                      <span
                        className={
                          'text-muted-foreground shrink-0 text-xs tabular-nums'
                        }
                      >
                        {format.dateTime(new Date(row.sent_at), {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: zone,
                        })}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {rows.length >= limit && rows.length < props.total ? (
            <Button
              variant={'outline'}
              className={'self-center'}
              loading={isFetching}
              onClick={() => setLimit((value) => value + SENT_PAGE)}
            >
              {t('more')}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Détail d'un envoi : ce que Prospectigo a fait, le message exact, l'expéditeur. */
function SentDetail(props: {
  card: AutopilotSentCard | null;
  senderLabel: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('campaigns.autopilot.live');
  const format = useFormatter();
  const client = useSupabase();
  const { card } = props;

  const screenshot = useQuery({
    queryKey: ['lm-attempt-screenshot', card?.screenshot_after],
    queryFn: () =>
      fetchAttemptScreenshot(client, card?.screenshot_after ?? null),
    enabled: Boolean(card?.screenshot_after),
    staleTime: 30 * 60_000,
  });

  const time = (value: string | null | undefined) =>
    value
      ? format.dateTime(new Date(value), {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      : '';

  const site = card ? displayHost(card.prospect.website) : '';
  const formPage = card?.form_url ? displayHost(card.form_url) : '';

  const steps = card
    ? [
        { label: t('detail.visited'), color: '#c8c8ff' },
        {
          label: formPage
            ? t('detail.formFoundOn', { page: formPage })
            : t('detail.formFound'),
          color: '#8b8bff',
        },
        { label: t('detail.filled'), color: '#3d3dff' },
        {
          label:
            card.status === 'to_verify'
              ? t('detail.sentToVerify')
              : t('detail.sent'),
          color: '#157a40',
          time: time(card.sent_at),
        },
      ]
    : [];

  return (
    <Sheet
      open={card !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetContent
        className={
          'w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]'
        }
        data-test={'autopilot-sent-detail'}
      >
        {card ? (
          <div className={'flex flex-col gap-6 p-6'}>
            <SheetHeader className={'flex-row items-start gap-3.5 p-0 pr-8'}>
              <ProspectBadge name={card.prospect.name} size={'lg'} />

              <div className={'flex min-w-0 flex-col gap-0.5'}>
                <SheetTitle className={'text-xl leading-tight'}>
                  {card.prospect.name}
                </SheetTitle>
                <SheetDescription>
                  {[card.activity, card.prospect.city]
                    .filter(Boolean)
                    .join(' · ')}
                </SheetDescription>
                {card.prospect.website ? (
                  <a
                    href={card.prospect.website}
                    target={'_blank'}
                    rel={'noreferrer noopener'}
                    className={'text-brand text-sm hover:underline'}
                  >
                    {site}
                  </a>
                ) : null}
              </div>
            </SheetHeader>

            <p
              className={
                'bg-ok-pale text-ok flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium'
              }
            >
              <Check className={'size-4 shrink-0'} strokeWidth={2.5} />
              {card.sent_at
                ? t('detail.banner', {
                    when: format.dateTime(new Date(card.sent_at), {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone:
                        Intl.DateTimeFormat().resolvedOptions().timeZone,
                    }),
                  })
                : t('received')}
            </p>

            <div className={'flex flex-col'}>
              <span className={'text-muted-foreground mb-3 text-[13px]'}>
                {t('detail.stepsTitle')}
              </span>

              <ol>
                {steps.map((step, index) => (
                  <li key={step.label} className={'flex gap-3.5'}>
                    <span className={'flex w-3.5 flex-col items-center'}>
                      <span
                        aria-hidden
                        className={'mt-1 size-3 shrink-0 rounded-full'}
                        style={{ background: step.color }}
                      />
                      {index < steps.length - 1 ? (
                        <span
                          aria-hidden
                          className={'bg-brand-pale w-0.5 flex-1'}
                        />
                      ) : null}
                    </span>
                    <span
                      className={
                        'flex flex-1 justify-between gap-3 pb-4 text-sm'
                      }
                    >
                      <span>{step.label}</span>
                      {step.time ? (
                        <span className={'text-muted-foreground'}>
                          {step.time}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className={'flex flex-col gap-2.5'}>
              <span className={'text-muted-foreground text-[13px]'}>
                {card.template_name
                  ? t('detail.messageVersion', { name: card.template_name })
                  : t('detail.message')}
              </span>
              <div
                className={
                  'bg-brand-pale/70 rounded-2xl rounded-bl-sm px-4 py-3.5 text-sm leading-relaxed whitespace-pre-line'
                }
              >
                {card.subject ? (
                  <p className={'mb-1.5 font-semibold'}>{card.subject}</p>
                ) : null}
                {card.body}
              </div>
            </div>

            {props.senderLabel ? (
              <div className={'flex flex-col gap-1.5'}>
                <span className={'text-muted-foreground text-[13px]'}>
                  {t('detail.sender')}
                </span>
                <span className={'text-sm'}>{props.senderLabel}</span>
              </div>
            ) : null}

            <div className={'flex flex-wrap gap-2'}>
              {card.form_url ? (
                <Button
                  variant={'outline'}
                  nativeButton={false}
                  render={
                    <a
                      href={card.form_url}
                      target={'_blank'}
                      rel={'noreferrer noopener'}
                    />
                  }
                >
                  {t('detail.openForm')}
                </Button>
              ) : null}

              {screenshot.data ? (
                <Button
                  variant={'outline'}
                  nativeButton={false}
                  render={
                    <a
                      href={screenshot.data}
                      target={'_blank'}
                      rel={'noreferrer noopener'}
                    />
                  }
                >
                  {t('detail.openScreenshot')}
                </Button>
              ) : null}

              <Button variant={'ghost'} onClick={props.onClose}>
                <X />
                {t('detail.close')}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Prévision de fin : rythme des envois des 3 dernières heures d'activité, projeté sur les heures où le pilote
 * envoie (heures de bureau du fuseau des entreprises contactées, ou en continu) ; « étalé sur N jours » : fin du
 * dernier jour prévu. Barres : envois des 10 dernières heures, rapportés au maximum.
 */
function forecastEnd(params: {
  sentTimes: number[];
  now: number;
  target: number;
  sent: number;
  schedule: string | null;
  spreadDays: number | null;
  timezone: string | null;
  startedAt: string | null;
}):
  | { kind: 'date'; end: Date; perHour: number; bars: number[] }
  | { kind: 'done' | 'soon'; perHour: number; bars: number[] } {
  const hour = 3_600_000;
  const now = params.now || params.sentTimes.at(-1) || 0;
  const buckets = Array.from({ length: 10 }, (_, index) => {
    const from = now - (10 - index) * hour;

    return params.sentTimes.filter((time) => time > from && time <= from + hour)
      .length;
  });
  const top = Math.max(1, ...buckets);
  const bars = buckets.map((count) => count / top);

  if (params.sent >= params.target) {
    return { kind: 'done', perHour: 0, bars };
  }

  const last = params.sentTimes.at(-1);
  const recent = last
    ? params.sentTimes.filter((time) => time >= last - 3 * hour)
    : [];

  if (recent.length < 3 || !last) {
    return { kind: 'soon', perHour: 0, bars };
  }

  const span = Math.max(0.25 * hour, last - recent[0]!);
  const perHour = (recent.length / span) * hour;

  if (params.schedule === 'spread' && params.startedAt && params.spreadDays) {
    let end = new Date(params.startedAt);
    let left = params.spreadDays;

    while (left > 0) {
      end = new Date(end.getTime() + 24 * hour);

      if (end.getDay() !== 0 && end.getDay() !== 6) {
        left -= 1;
      }
    }

    return { kind: 'date', end, perHour, bars };
  }

  let remaining = params.target - params.sent;
  let cursor = Math.max(now, last);
  const zone = params.timezone ?? 'UTC';
  const office = params.schedule !== 'continuous';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  });

  // heure par heure, au plus 180 jours pour ne jamais boucler sans fin ; la dernière heure compte au prorata
  // (12/11/2026 : avant, toujours au moins une heure entière → la fin reculait d'une heure à chaque visite)
  for (let step = 0; step < 180 * 24 && remaining > 0; step++) {
    if (office) {
      const values = Object.fromEntries(
        parts
          .formatToParts(new Date(cursor))
          .map((part) => [part.type, part.value]),
      );
      const localHour = Number(values.hour);

      if (
        values.weekday === 'Sat' ||
        values.weekday === 'Sun' ||
        localHour < 9 ||
        localHour >= 18
      ) {
        cursor += hour;
        continue;
      }
    }

    if (remaining <= perHour) {
      cursor += (remaining / perHour) * hour;
      remaining = 0;
      break;
    }

    remaining -= perHour;
    cursor += hour;
  }

  return { kind: 'date', end: new Date(cursor), perHour, bars };
}

function hash(value: string) {
  let h = 0;

  for (const char of value) {
    h = (h * 31 + char.charCodeAt(0)) >>> 0;
  }

  return h;
}
