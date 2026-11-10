'use client';

/**
 * Rôle : étape Envoi en mode pilote automatique : réglage, aperçu à valider, suivi en direct, pause / reprise.
 * Réglage regroupé le 10/11/2026 (CDC-PARCOURS-TRI-ANNUAIRE §6 « Écran 4 ») : planification, note sur les réglages
 * du mode Avancé, expéditeur, messages, nombre, puis « Lancer » avec un résumé sur une ligne. Mêmes réglages et
 * mêmes actions qu'avant.
 * Données : lm_autopilots et tentatives lus côté client (~/lib/leadmaker/autopilot-query), rafraîchis toutes les 4 s.
 * Écritures : start/update/pause/resume/confirm/cancel (autopilot-actions.ts).
 */

import { useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Minus, Pause, Play, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import {
  type AutopilotFeedRow,
  type AutopilotSummary,
  displayHost,
  fetchAutopilotFeed,
  fetchAutopilotPreview,
  fetchAutopilotSummary,
  isAutopilotActive,
  isCleanAttempt,
} from '~/lib/leadmaker/autopilot-query';
import { MAX_MESSAGES } from '~/lib/leadmaker/templates';

import type { AutopilotSchedule } from '../../_lib/schema/autopilot.schema';
import {
  cancelAutopilotAction,
  confirmAutopilotAction,
  pauseAutopilotAction,
  resumeAutopilotAction,
  startAutopilotAction,
  updateAutopilotAction,
} from '../../_lib/server/autopilot-actions';

const POLL_MS = 4_000;
const STEP = 50;
const PRESETS = [100, 250, 500, 1000];
/** bornes de « Répartir sur N jours » (mêmes que AutopilotSettings et lm_autopilots_spread_days) */
const SPREAD_MIN = 1;
const SPREAD_MAX = 60;

export interface AutopilotMessage {
  name: string;
  preview: string;
  /** « Un message par groupe » : nom du groupe du message (null = « Pour les autres ») */
  group: string | null;
}

interface SetupValues {
  target: number;
  draft: string | null;
  messages: string[];
  schedule: AutopilotSchedule;
  spreadDays: number;
  /** saisie en cours de « Répartir sur » (bornée à la sortie du champ) */
  spreadDraft: string | null;
  preview: boolean;
}

/**
 * Étape 4, mode « Pilote automatique » : on choisit un nombre d'entreprises à
 * contacter, les messages et le moment d'envoi ; Prospectigo prépare et envoie
 * prospect après prospect. Écrans : réglage, aperçu des 3 premiers formulaires,
 * suivi en direct (envoyés / en cours / mis de côté, pause).
 */
export function ContactAutopilot(props: {
  campaignId: string;
  initialSummary: AutopilotSummary | null;
  messages: AutopilotMessage[];
  /** « Un message par groupe » : messages rangés par groupe, tous cochés par défaut */
  perGroup: boolean;
  writeHref: string;
  advancedHref: string;
  /** mode Avancé, où se règlent les prises de contact par jour et la validation automatique */
  sendingSettingsHref: string;
  /** section « Qui envoie ? » (rendue côté serveur) */
  senderSection: React.ReactNode;
  billingHref: string;
  /** l'organisation a un forfait (sinon le pilote ne peut rien envoyer) */
  hasPlan: boolean;
  ready: boolean;
}) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const summaryKey = ['lm-autopilot', props.campaignId];

  // le résumé des étapes (en haut de page) est rendu côté serveur : rafraîchi quand le passage change
  // d'état ou qu'un message part
  const seen = useRef(
    `${props.initialSummary?.status}:${props.initialSummary?.sent}`,
  );

  const { data: summary, dataUpdatedAt } = useQuery({
    queryKey: summaryKey,
    queryFn: async () => {
      const next = await fetchAutopilotSummary(client, props.campaignId);
      const mark = `${next?.status}:${next?.sent}`;

      if (mark !== seen.current) {
        seen.current = mark;
        router.refresh();
      }

      return next;
    },
    initialData: props.initialSummary,
    refetchInterval: (query) =>
      isAutopilotActive(query.state.data?.status) ? POLL_MS : false,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['lm-autopilot'] });
    void queryClient.invalidateQueries({ queryKey: ['lm-autopilot-feed'] });
    void queryClient.invalidateQueries({ queryKey: ['lm-autopilot-preview'] });
    router.refresh();
  };

  const active = isAutopilotActive(summary?.status);
  // un passage terminé reste affiché (bilan) jusqu'à « Contacter d'autres entreprises »
  const showSetup =
    editing || !summary?.status || summary.status === 'cancelled';

  if (!summary) {
    return null;
  }

  if (showSetup) {
    return (
      <AutopilotSetup
        key={editing ? `edit-${summary.autopilot_id}` : 'new'}
        campaignId={props.campaignId}
        summary={summary}
        editing={editing && active}
        messages={props.messages}
        perGroup={props.perGroup}
        writeHref={props.writeHref}
        sendingSettingsHref={props.sendingSettingsHref}
        senderSection={props.senderSection}
        billingHref={props.billingHref}
        hasPlan={props.hasPlan}
        ready={props.ready}
        onDone={() => {
          setEditing(false);
          refreshAll();
        }}
        onCancelEdit={editing ? () => setEditing(false) : undefined}
      />
    );
  }

  if (summary.status === 'preview') {
    return (
      <AutopilotPreview
        summary={summary}
        writeHref={props.writeHref}
        onDone={refreshAll}
      />
    );
  }

  return (
    <AutopilotRunning
      summary={summary}
      checkedAt={dataUpdatedAt}
      advancedHref={props.advancedHref}
      billingHref={props.billingHref}
      hasPlan={props.hasPlan}
      onEdit={() => setEditing(true)}
      onDone={refreshAll}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Réglage                                                             */
/* ------------------------------------------------------------------ */

function AutopilotSetup(props: {
  campaignId: string;
  summary: AutopilotSummary;
  editing: boolean;
  messages: AutopilotMessage[];
  perGroup: boolean;
  writeHref: string;
  sendingSettingsHref: string;
  senderSection: React.ReactNode;
  billingHref: string;
  hasPlan: boolean;
  ready: boolean;
  onDone: () => void;
  onCancelEdit?: () => void;
}) {
  const t = useTranslations('campaigns.autopilot');
  const tAll = useTranslations();
  const format = useFormatter();
  const { summary } = props;

  // bornes du nombre : en modification, jamais sous ce qui est parti ou en cours.
  // Crédit unique (9/11) : les envois sont gratuits, seul le nombre d'entreprises contactables limite
  // (summary.balance est l'ancien solde de prise de contact : plus lu).
  const base = props.editing ? summary.sent + summary.in_flight : 0;
  const room = props.hasPlan ? summary.contactable : 0;
  const max = base + room;
  const min = Math.max(base, 1);

  const known = new Set(props.messages.map((message) => message.name));
  const previous = (summary.messages ?? []).filter((name) => known.has(name));

  const form = useForm<SetupValues>({
    defaultValues: {
      target: props.editing
        ? Math.min(Math.max(summary.target, min), max)
        : Math.min(500, Math.max(max, 1)),
      draft: null,
      // « Un message par groupe » : tous cochés (chaque groupe garde ainsi ses messages) ; sinon le premier
      messages:
        previous.length > 0
          ? previous
          : props.messages
              .slice(0, props.perGroup ? MAX_MESSAGES : 1)
              .map((message) => message.name),
      schedule: (summary.schedule as AutopilotSchedule | null) ?? 'office',
      spreadDays: summary.spread_days ?? 5,
      spreadDraft: null,
      preview: !summary.contacted_before,
    },
  });

  const values = form.watch();
  const clamp = (value: number) => Math.min(Math.max(value, min), max);
  const setTarget = (value: number) => {
    form.setValue('target', clamp(value));
    form.setValue('draft', null);
  };
  const clampSpread = (value: number) =>
    Math.min(Math.max(Math.round(value), SPREAD_MIN), SPREAD_MAX);

  const onError = ({
    error,
  }: {
    error: { serverError?: string | undefined };
  }) => {
    toast.error(
      tAll(error.serverError ?? 'campaigns.autopilot.errors.generic'),
    );
  };

  const start = useAction(startAutopilotAction, {
    onSuccess: props.onDone,
    onError,
  });

  const update = useAction(updateAutopilotAction, {
    onSuccess: ({ data }) => {
      if (data && data.target !== values.target) {
        toast.info(t('targetAdjusted', { count: data.target }));
      }

      props.onDone();
    },
    onError,
  });

  const pending = start.isPending || update.isPending;

  const submit = form.handleSubmit((input) => {
    const settings = {
      target: clamp(input.target),
      messages: input.messages,
      schedule: input.schedule,
      spreadDays: clampSpread(input.spreadDays),
    };

    if (props.editing && summary.autopilot_id) {
      update.execute({ autopilotId: summary.autopilot_id, ...settings });
    } else {
      start.execute({
        campaignId: props.campaignId,
        preview: input.preview,
        ...settings,
      });
    }
  });

  if (!props.editing && max === 0) {
    return (
      <SetupBlocked
        noPlan={!props.hasPlan}
        billingHref={props.billingHref}
        finished={summary.status === 'done'}
        sent={summary.sent}
      />
    );
  }

  const target = clamp(values.target);
  const presets = PRESETS.filter((value) => value >= min && value < max);
  const spreadDays = clampSpread(values.spreadDays);
  const perDay = Math.ceil(target / spreadDays);
  const abCount = values.messages.length;

  const renderMessage = (message: AutopilotMessage) => {
    const checked = values.messages.includes(message.name);

    return (
      <label
        key={message.name}
        className={cn(
          'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3',
          checked ? 'border-brand bg-brand-pale/60' : 'bg-card',
        )}
      >
        <input
          type={'checkbox'}
          className={'accent-primary mt-0.5 size-5 shrink-0'}
          data-test={'autopilot-message'}
          checked={checked}
          onChange={() => {
            const next = checked
              ? values.messages.filter((name) => name !== message.name)
              : [...values.messages, message.name];

            // au moins un message reste coché
            if (next.length > 0) {
              form.setValue(
                'messages',
                props.messages
                  .map((item) => item.name)
                  .filter((name) => next.includes(name)),
              );
            }
          }}
        />

        <span className={'min-w-0'}>
          <span className={'block font-medium'}>{message.name}</span>

          <span
            className={'text-muted-foreground line-clamp-2 text-sm break-words'}
          >
            {message.preview}
          </span>
        </span>
      </label>
    );
  };

  // « Un message par groupe » : un bloc par groupe (dans l'ordre reçu), « Pour les autres » en dernier
  const messageSections = props.perGroup
    ? [
        ...new Set(
          props.messages.flatMap((message) =>
            message.group === null ? [] : [message.group],
          ),
        ),
        null,
      ]
        .map((heading) => ({
          heading,
          messages: props.messages.filter(
            (message) => message.group === heading,
          ),
        }))
        .filter((section) => section.messages.length > 0)
    : [{ heading: null, messages: props.messages }];

  const paceText =
    values.schedule === 'office'
      ? t('pace.officeText')
      : values.schedule === 'spread'
        ? t('pace.spreadText', { perDay, days: spreadDays })
        : t('pace.continuousText', { count: target });

  return (
    <form
      onSubmit={submit}
      className={'flex flex-col items-start gap-5 lg:flex-row'}
      data-test={'autopilot-setup'}
    >
      <div
        className={
          'bg-card flex w-full min-w-0 flex-col gap-6 rounded-2xl border p-6 lg:flex-[2]'
        }
      >
        {/* 1. Planification */}
        <section
          className={'flex flex-col gap-3'}
          data-test={'autopilot-schedule'}
        >
          <h2 className={'font-heading text-xl font-medium tracking-[-0.01em]'}>
            {t('pace.title')}
          </h2>

          <div className={'grid grid-cols-1 gap-2.5 sm:grid-cols-3'}>
            {(['office', 'spread', 'continuous'] as const).map((schedule) => (
              <button
                key={schedule}
                type={'button'}
                data-test={`autopilot-pace-${schedule}`}
                aria-pressed={values.schedule === schedule}
                onClick={() => form.setValue('schedule', schedule)}
                className={cn(
                  'rounded-xl border p-3 text-left transition-colors',
                  values.schedule === schedule
                    ? 'border-brand bg-brand-pale/60 ring-brand ring-1'
                    : 'hover:bg-muted/50',
                )}
              >
                <span className={'block font-medium'}>
                  {t(`pace.${schedule}`)}
                </span>

                <span
                  className={
                    'text-muted-foreground mt-1 block text-sm leading-snug'
                  }
                >
                  {t(`pace.${schedule}Sub`)}
                </span>
              </button>
            ))}
          </div>

          {values.schedule === 'spread' ? (
            <label className={'flex flex-wrap items-center gap-2 text-sm'}>
              <span>{t('pace.spreadOver')}</span>

              <Input
                type={'number'}
                inputMode={'numeric'}
                min={SPREAD_MIN}
                max={SPREAD_MAX}
                step={1}
                className={'w-20 tabular-nums'}
                data-test={'autopilot-spread-days'}
                value={values.spreadDraft ?? String(spreadDays)}
                onChange={(event) => {
                  const raw = event.target.value;
                  const parsed = Number.parseInt(raw, 10);

                  form.setValue('spreadDraft', raw);

                  if (Number.isFinite(parsed) && parsed >= SPREAD_MIN) {
                    form.setValue('spreadDays', clampSpread(parsed));
                  }
                }}
                onBlur={() => form.setValue('spreadDraft', null)}
              />

              <span>
                {tAll('outreach.sendStep.spreadDaysUnit', {
                  count: spreadDays,
                })}
              </span>
            </label>
          ) : null}

          <p
            className={'bg-brand-pale rounded-lg px-3 py-2.5 text-sm'}
            data-test={'autopilot-pace-text'}
          >
            {paceText}
          </p>
        </section>

        {/* 2. Prises de contact par jour et validation automatique : réglages du mode Avancé (le pilote suit
            sa planification et envoie seul les formulaires sans alerte, lm_queue_sends) */}
        <p
          className={'text-muted-foreground border-t pt-5 text-sm'}
          data-test={'autopilot-advanced-settings-note'}
        >
          {tAll('outreach.sendStep.autopilotSettingsNote')}{' '}
          <Link href={props.sendingSettingsHref} className={'text-primary'}>
            {tAll('outreach.sendStep.autopilotSettingsLink')}
          </Link>
        </p>

        {/* 3. Expéditeur */}
        <div className={'border-t pt-5'}>{props.senderSection}</div>

        {/* 4. Messages (versions) */}
        <section className={'flex flex-col gap-3 border-t pt-5'}>
          <div className={'flex flex-wrap justify-between gap-2'}>
            <h3 className={'text-base font-medium'}>{t('messages.title')}</h3>

            <Link href={props.writeHref} className={'text-primary text-sm'}>
              {t('messages.edit')}
            </Link>
          </div>

          {messageSections.map((section) => (
            <div
              key={section.heading ?? '-'}
              className={'flex flex-col gap-2'}
              data-test={'autopilot-message-section'}
            >
              {props.perGroup ? (
                <h4 className={'text-muted-foreground text-sm font-medium'}>
                  {section.heading ?? t('messages.othersHeading')}
                </h4>
              ) : null}

              <div className={'grid grid-cols-1 gap-2.5 sm:grid-cols-2'}>
                {section.messages.map(renderMessage)}
              </div>
            </div>
          ))}

          <p
            className={cn(
              'rounded-lg px-3 py-2.5 text-sm',
              abCount >= 2 || props.perGroup
                ? 'bg-brand-pale'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {props.perGroup
              ? t('messages.perGroup', { count: abCount })
              : abCount >= 2
                ? t('messages.ab', {
                    count: abCount,
                    share: Math.round(100 / abCount),
                  })
                : t('messages.single')}
          </p>
        </section>

        {/* 5. Nombre d'entreprises */}
        <section className={'flex flex-col gap-3 border-t pt-5'}>
          <div className={'flex flex-col gap-1'}>
            <h3 className={'text-base font-medium'}>{t('question')}</h3>

            <p className={'text-muted-foreground text-sm'}>
              {t('questionHint')}
            </p>
          </div>

          <div className={'flex items-center gap-3'}>
            <Button
              type={'button'}
              variant={'outline'}
              size={'icon'}
              className={'size-12'}
              aria-label={t('less')}
              disabled={target <= min}
              onClick={() => setTarget(target - STEP)}
            >
              <Minus className={'size-5'} />
            </Button>

            <input
              type={'number'}
              inputMode={'numeric'}
              min={min}
              max={max}
              step={1}
              aria-label={t('countLabel')}
              data-test={'autopilot-count'}
              className={
                'font-heading text-primary border-input bg-background h-16 w-44 rounded-xl border px-2 text-center text-4xl font-normal tabular-nums sm:w-56 sm:text-5xl'
              }
              value={values.draft ?? String(target)}
              onChange={(event) => {
                const raw = event.target.value;
                const parsed = Number.parseInt(raw, 10);

                form.setValue('draft', raw);

                if (Number.isFinite(parsed) && parsed >= 1) {
                  form.setValue('target', parsed);
                }
              }}
              onBlur={() => setTarget(values.target)}
            />

            <Button
              type={'button'}
              variant={'outline'}
              size={'icon'}
              className={'size-12'}
              aria-label={t('more')}
              disabled={target >= max}
              onClick={() => setTarget(target + STEP)}
            >
              <Plus className={'size-5'} />
            </Button>
          </div>

          <div className={'flex flex-wrap gap-2'}>
            {presets.map((value) => (
              <Chip
                key={value}
                selected={target === value}
                onClick={() => setTarget(value)}
              >
                {format.number(value)}
              </Chip>
            ))}

            <Chip
              selected={target === max}
              onClick={() => setTarget(max)}
              testId={'autopilot-count-all'}
            >
              {t('all', { count: max })}
            </Chip>
          </div>

          <p className={'text-muted-foreground text-sm'}>
            {props.editing
              ? t('maxHintEdit', { min, max })
              : t('maxHint', {
                  max,
                  prospects: summary.contactable,
                })}
          </p>
        </section>

        {props.editing ? null : (
          <label
            className={
              'border-brand/40 bg-brand/10 flex cursor-pointer items-start gap-3 rounded-xl border p-4'
            }
          >
            <input
              type={'checkbox'}
              className={'accent-primary mt-0.5 size-5 shrink-0'}
              data-test={'autopilot-preview-toggle'}
              checked={values.preview}
              onChange={() => form.setValue('preview', !values.preview)}
            />

            <span>
              <span className={'block font-medium'}>{t('preview.toggle')}</span>

              <span className={'text-muted-foreground text-sm'}>
                {t('preview.toggleHint')}
              </span>
            </span>
          </label>
        )}

        {/* 6. Lancer, avec le résumé sur une ligne */}
        <div
          className={
            'flex flex-wrap items-center justify-between gap-3 border-t pt-5'
          }
        >
          <span
            className={'text-muted-foreground text-sm tabular-nums'}
            data-test={'autopilot-launch-summary'}
          >
            {tAll('outreach.sendStep.launchSummary', {
              companies: target,
              versions: abCount,
            })}
          </span>

          <div className={'flex flex-wrap items-center gap-3'}>
            {props.onCancelEdit ? (
              <Button
                type={'button'}
                variant={'ghost'}
                onClick={props.onCancelEdit}
              >
                {t('cancelEdit')}
              </Button>
            ) : null}

            <Button
              type={'submit'}
              size={'lg'}
              disabled={!props.ready}
              loading={pending}
              data-test={'autopilot-launch'}
            >
              {props.editing
                ? t('update')
                : values.preview
                  ? t('launchPreview', {
                      count: Math.min(3, target),
                    })
                  : t('launch')}
            </Button>
          </div>
        </div>
      </div>

      <aside
        className={
          'bg-card flex w-full flex-col gap-3.5 rounded-2xl border p-6 lg:flex-1'
        }
      >
        <h3 className={'font-heading text-lg font-medium tracking-[-0.01em]'}>
          {t('how.title')}
        </h3>

        {(['1', '2', '3', '4'] as const).map((step) => (
          <div key={step} className={'flex gap-2.5'}>
            <span className={'text-primary font-medium'}>{step}</span>

            <span className={'leading-snug'}>
              {t(`how.step${step}`, { count: target })}
            </span>
          </div>
        ))}

        <p className={'text-muted-foreground border-t pt-3.5 text-sm'}>
          {t('how.credits', { count: target })}
        </p>
      </aside>
    </form>
  );
}

function SetupBlocked(props: {
  noPlan: boolean;
  billingHref: string;
  finished: boolean;
  sent: number;
}) {
  const t = useTranslations('campaigns.autopilot');

  return (
    <div
      className={'bg-card flex flex-col gap-3 rounded-2xl border p-6'}
      data-test={'autopilot-blocked'}
    >
      {props.finished ? (
        <h2 className={'font-heading text-xl font-medium tracking-[-0.01em]'}>
          {t('run.doneTitle', { count: props.sent })}
        </h2>
      ) : null}

      <p className={'text-muted-foreground'}>
        {props.noPlan ? t('blocked.noPlan') : t('blocked.noProspects')}
      </p>

      {props.noPlan ? (
        <Button
          nativeButton={false}
          className={'self-start'}
          render={<Link href={props.billingHref} />}
        >
          {t('blocked.billing')}
        </Button>
      ) : null}
    </div>
  );
}

function Chip(
  props: React.PropsWithChildren<{
    selected: boolean;
    onClick: () => void;
    testId?: string;
  }>,
) {
  return (
    <button
      type={'button'}
      aria-pressed={props.selected}
      data-test={props.testId}
      onClick={props.onClick}
      className={cn(
        'flex h-8 items-center rounded-full px-3.5 text-[14px] font-medium tabular-nums transition-colors',
        props.selected
          ? 'bg-brand-pale text-brand-hover dark:text-brand'
          : 'bg-card ring-pill-ring shadow-soft hover:bg-muted ring-[0.5px]',
      )}
    >
      {props.children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Aperçu des 3 premiers formulaires                                   */
/* ------------------------------------------------------------------ */

function AutopilotPreview(props: {
  summary: AutopilotSummary;
  writeHref: string;
  onDone: () => void;
}) {
  const t = useTranslations('campaigns.autopilot.preview');
  const tAll = useTranslations();
  const client = useSupabase();
  const { summary } = props;
  const autopilotId = summary.autopilot_id ?? '';

  const waiting = summary.preview_ready < 3 && summary.in_flight > 0;

  const { data: rows = [] } = useQuery({
    queryKey: ['lm-autopilot-preview', autopilotId, summary.preview_ready],
    queryFn: () => fetchAutopilotPreview(client, autopilotId),
    enabled: Boolean(autopilotId),
  });

  const onError = ({
    error,
  }: {
    error: { serverError?: string | undefined };
  }) => {
    toast.error(
      tAll(error.serverError ?? 'campaigns.autopilot.errors.generic'),
    );
  };

  const confirm = useAction(confirmAutopilotAction, {
    onSuccess: props.onDone,
    onError,
  });

  const cancel = useAction(cancelAutopilotAction, {
    onSuccess: props.onDone,
    onError,
  });

  return (
    <div
      className={'bg-card flex flex-col gap-5 rounded-2xl border p-6'}
      data-test={'autopilot-preview'}
    >
      <div className={'flex flex-col gap-1.5'}>
        <h2 className={'font-heading text-2xl font-normal tracking-[-0.02em]'}>
          {waiting
            ? t('waitingTitle')
            : rows.length > 0
              ? t('readyTitle', { count: rows.length })
              : t('emptyTitle')}
        </h2>

        <p className={'text-muted-foreground flex items-center gap-2'}>
          {waiting ? (
            <>
              <Loader2 className={'size-4 shrink-0 animate-spin'} />
              <span>
                {t('waiting', { ready: summary.preview_ready, total: 3 })}
              </span>
            </>
          ) : rows.length > 0 ? (
            t('readyHint')
          ) : (
            t('emptyHint')
          )}
        </p>
      </div>

      {rows.length > 0 ? (
        <div className={'grid grid-cols-1 gap-4 md:grid-cols-3'}>
          {rows.map((row) => (
            <div
              key={row.id}
              className={'flex flex-col overflow-hidden rounded-xl border'}
              data-test={'autopilot-preview-card'}
            >
              <div
                className={
                  'bg-muted flex h-64 items-start justify-center overflow-hidden'
                }
              >
                {row.screenshotUrl ? (
                  // capture privée servie par un lien signé : pas d'optimisation d'image
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.screenshotUrl}
                    alt={t('screenshotAlt', { name: row.prospect.name })}
                    className={'w-full object-cover object-top'}
                  />
                ) : (
                  <p
                    className={
                      'text-muted-foreground p-4 text-sm whitespace-pre-line'
                    }
                  >
                    {row.body}
                  </p>
                )}
              </div>

              <div className={'flex items-center justify-between gap-2 p-3.5'}>
                <div className={'min-w-0'}>
                  <div className={'truncate font-medium'}>
                    {row.prospect.name}
                  </div>

                  <div className={'text-muted-foreground truncate text-sm'}>
                    {displayHost(row.form_url ?? row.prospect.website)}
                  </div>
                </div>

                <span
                  className={
                    'bg-brand-pale text-brand-hover dark:text-brand shrink-0 rounded-md px-2.5 py-1 text-xs font-medium'
                  }
                >
                  {t('ready')}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className={'flex flex-wrap items-center gap-3'}>
        {rows.length > 0 ? (
          <Button
            size={'lg'}
            disabled={cancel.isPending}
            loading={confirm.isPending}
            data-test={'autopilot-confirm'}
            onClick={() => confirm.execute({ autopilotId })}
          >
            {t('confirm', { count: rows.length })}
          </Button>
        ) : null}

        <Button
          variant={'outline'}
          size={'lg'}
          nativeButton={false}
          render={<Link href={props.writeHref} />}
        >
          {t('editMessage')}
        </Button>

        <Button
          variant={'ghost'}
          disabled={confirm.isPending}
          loading={cancel.isPending}
          data-test={'autopilot-cancel'}
          onClick={() => cancel.execute({ autopilotId })}
        >
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Suivi en direct                                                     */
/* ------------------------------------------------------------------ */

function AutopilotRunning(props: {
  summary: AutopilotSummary;
  /** heure du dernier rafraîchissement des compteurs (toutes les 4 s en marche) */
  checkedAt: number;
  advancedHref: string;
  billingHref: string;
  hasPlan: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('campaigns.autopilot.run');
  const tAll = useTranslations();
  const format = useFormatter();
  const { summary } = props;
  const autopilotId = summary.autopilot_id ?? '';

  const done = summary.status === 'done';
  const paused = summary.status === 'paused';
  const target = summary.target ?? 0;
  const pct = target > 0 ? Math.min(100, (summary.sent / target) * 100) : 0;

  const onError = ({
    error,
  }: {
    error: { serverError?: string | undefined };
  }) => {
    toast.error(
      tAll(error.serverError ?? 'campaigns.autopilot.errors.generic'),
    );
  };

  const pause = useAction(pauseAutopilotAction, {
    onSuccess: props.onDone,
    onError,
  });

  const resume = useAction(resumeAutopilotAction, {
    onSuccess: props.onDone,
    onError,
  });

  const nextSend = summary.next_send_at ? new Date(summary.next_send_at) : null;
  const waitingWindow =
    !done &&
    !paused &&
    nextSend !== null &&
    nextSend.getTime() - props.checkedAt > 60_000;
  // sans forfait le pilote attend (les envois ne coûtent pas de crédit, mais il faut un forfait)
  const noPlan = !done && !props.hasPlan;
  // juste après le lancement, tant que rien n'est parti ni mis de côté. Jamais de délai chiffré : il faut
  // quelques minutes pour préparer un formulaire (CDC-PARCOURS-TRI-ANNUAIRE §6, écran 4)
  const justLaunched =
    summary.status === 'running' &&
    summary.sent === 0 &&
    summary.aside === 0 &&
    !waitingWindow &&
    !noPlan;

  const title = done
    ? summary.finished_reason === 'no_prospects'
      ? t('doneNoProspects', { count: summary.sent })
      : t('doneTitle', { count: summary.sent })
    : paused
      ? t('paused')
      : t('running');

  return (
    <div
      className={'flex flex-col items-start gap-5 lg:flex-row'}
      data-test={'autopilot-running'}
    >
      <div
        className={
          'bg-card flex w-full min-w-0 flex-col gap-5 rounded-2xl border p-6 lg:flex-[2]'
        }
      >
        <div className={'flex flex-wrap items-center justify-between gap-3'}>
          <div className={'flex items-center gap-2.5'}>
            <span
              aria-hidden
              className={cn(
                'size-3 rounded-full',
                done
                  ? 'bg-ok'
                  : paused
                    ? 'bg-muted-foreground/50'
                    : 'bg-brand animate-pulse',
              )}
            />

            <span
              className={'text-lg font-medium'}
              data-test={'autopilot-title'}
            >
              {title}
            </span>
          </div>

          <div className={'flex flex-wrap gap-2'}>
            {done ? null : paused ? (
              <Button
                variant={'outline'}
                loading={resume.isPending}
                data-test={'autopilot-resume'}
                onClick={() => resume.execute({ autopilotId })}
              >
                <Play className={'size-4'} />
                {t('resume')}
              </Button>
            ) : (
              <Button
                variant={'outline'}
                loading={pause.isPending}
                data-test={'autopilot-pause'}
                onClick={() => pause.execute({ autopilotId })}
              >
                <Pause className={'size-4'} />
                {t('pause')}
              </Button>
            )}

            <Button
              variant={'outline'}
              data-test={'autopilot-edit'}
              onClick={props.onEdit}
            >
              {done ? t('again') : t('edit')}
            </Button>
          </div>
        </div>

        <div className={'flex items-baseline gap-2.5'}>
          <span
            className={
              'font-heading text-primary text-5xl font-light tracking-[-0.02em] tabular-nums'
            }
            data-test={'autopilot-sent'}
          >
            {format.number(summary.sent)}
          </span>

          <span className={'text-muted-foreground text-xl'}>
            {t('ofSent', { count: target })}
          </span>
        </div>

        <div
          className={'bg-muted h-2 overflow-hidden rounded-full'}
          role={'progressbar'}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={summary.sent}
          aria-label={t('progressLabel')}
        >
          <div
            className={'bg-brand h-full rounded-full transition-all'}
            style={{ width: `${pct}%` }}
          />
        </div>

        {justLaunched ? (
          <p
            className={'bg-brand-pale rounded-lg px-3 py-2.5 text-sm'}
            data-test={'autopilot-launched'}
          >
            <span className={'font-medium'}>
              {tAll('outreach.sendStep.launchedTitle')}
            </span>{' '}
            {tAll('outreach.sendStep.launchedText')}
          </p>
        ) : null}

        {waitingWindow && nextSend ? (
          <p
            className={'bg-muted rounded-lg px-3 py-2.5 text-sm'}
            data-test={'autopilot-next-send'}
          >
            {t('nextSend', {
              when: format.dateTime(nextSend, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: summary.timezone ?? undefined,
              }),
              // « Europe/Paris » → « Paris »
              zone: (
                (summary.timezone ?? 'UTC').split('/').pop() ?? 'UTC'
              )?.replaceAll('_', ' '),
            })}
          </p>
        ) : null}

        {noPlan ? (
          <p
            className={'bg-brand/10 rounded-lg px-3 py-2.5 text-sm'}
            data-test={'autopilot-no-plan'}
          >
            {t('noPlan')}{' '}
            <Link href={props.billingHref} className={'text-primary underline'}>
              {t('billing')}
            </Link>
          </p>
        ) : null}

        <div className={'grid grid-cols-3 gap-2 sm:gap-3'}>
          <Tile label={t('sent')} value={format.number(summary.sent)} />
          <Tile
            label={t('inFlight')}
            value={format.number(done || paused ? 0 : summary.in_flight)}
            testId={'autopilot-in-flight'}
          />
          <Tile
            label={t('aside')}
            value={format.number(summary.aside)}
            warm
            testId={'autopilot-aside'}
          />
        </div>

        <p className={'text-muted-foreground text-sm'}>
          {t('asideHint')}{' '}
          <Link href={props.advancedHref} className={'text-primary underline'}>
            {t('seeAdvanced')}
          </Link>
        </p>
      </div>

      <AutopilotFeed autopilotId={autopilotId} live={!done && !paused} />
    </div>
  );
}

function Tile(props: {
  label: string;
  value: string;
  warm?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-3.5',
        props.warm ? 'bg-brand/10' : 'bg-muted/60',
      )}
    >
      <div className={'text-muted-foreground text-sm'}>{props.label}</div>
      <div
        className={'text-2xl font-medium tabular-nums'}
        data-test={props.testId}
      >
        {props.value}
      </div>
    </div>
  );
}

/** Fil « En direct » : une ligne par vrai événement (dernières tentatives du passage). */
function AutopilotFeed(props: { autopilotId: string; live: boolean }) {
  const t = useTranslations('campaigns.autopilot.feed');
  const format = useFormatter();
  const client = useSupabase();

  const { data: rows = [] } = useQuery({
    queryKey: ['lm-autopilot-feed', props.autopilotId],
    queryFn: () => fetchAutopilotFeed(client, props.autopilotId),
    enabled: Boolean(props.autopilotId),
    refetchInterval: props.live ? POLL_MS : false,
  });

  return (
    <aside
      className={
        'flex w-full min-w-0 flex-col gap-3 rounded-2xl bg-[#0e2a27] p-5 text-[#e8f0ee] lg:flex-1'
      }
      data-test={'autopilot-feed'}
    >
      <h3 className={'font-medium'}>{t('title')}</h3>

      <ol className={'flex flex-col gap-2 font-mono text-[14px] leading-snug'}>
        {rows.length === 0 ? (
          <li className={'text-[#8fb3ac]'}>{t('empty')}</li>
        ) : (
          rows.map((row) => {
            const line = feedLine(row);

            return (
              <li key={row.id} className={'flex gap-2.5'}>
                <span className={'shrink-0 text-[#8fb3ac]'}>
                  {format.dateTime(new Date(row.updated_at), {
                    hour: '2-digit',
                    minute: '2-digit',
                    // heure de l'utilisateur (le fil n'est rendu que dans le navigateur)
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  })}
                </span>

                <span
                  className={cn(
                    'min-w-0 break-words',
                    line.kind === 'ok' && 'text-[#9be0c6]',
                    line.kind === 'warn' && 'text-[#f2c66b]',
                  )}
                >
                  {t(line.key, {
                    name: row.prospect.name,
                    site: displayHost(row.form_url ?? row.prospect.website),
                  })}
                </span>
              </li>
            );
          })
        )}
      </ol>
    </aside>
  );
}

function feedLine(row: AutopilotFeedRow): {
  key: string;
  kind: 'ok' | 'warn' | 'info';
} {
  switch (row.status) {
    case 'sent':
      return { key: 'sent', kind: 'ok' };
    case 'to_verify':
      return { key: 'toVerify', kind: 'ok' };
    case 'sending':
      return { key: 'sending', kind: 'info' };
    case 'validated':
      return { key: 'found', kind: 'info' };
    case 'ready':
      return isCleanAttempt(row)
        ? { key: 'found', kind: 'info' }
        : { key: 'doubt', kind: 'warn' };
    case 'preparing':
      return { key: 'visiting', kind: 'info' };
    case 'pending':
      return { key: 'queued', kind: 'info' };
    case 'intervention_required':
      return { key: 'captcha', kind: 'warn' };
    case 'incomplete':
      return { key: 'unknownField', kind: 'warn' };
    case 'no_form':
      return { key: 'noForm', kind: 'warn' };
    case 'skipped':
      return { key: 'skipped', kind: 'warn' };
    case 'excluded':
      return { key: 'excluded', kind: 'warn' };
    default:
      return { key: 'unreachable', kind: 'warn' };
  }
}
