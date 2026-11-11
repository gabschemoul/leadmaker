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
import {
  ChevronRight,
  Clock,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import { chipClasses } from '@kit/ui/button-extras';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import {
  type AutopilotSummary,
  displayHost,
  fetchAutopilotPreview,
  fetchAutopilotSummary,
  isAutopilotActive,
} from '~/lib/leadmaker/autopilot-query';
import { MAX_MESSAGES } from '~/lib/leadmaker/templates';

import { Kpi, KpiStrip } from '../../../_components/leadmaker/kpi-strip';
import {
  panelLinkClasses,
  panelSelectClasses,
  panelSelectorClasses,
} from '../../../_components/leadmaker/panel-classes';
import type { AutopilotSchedule } from '../../_lib/schema/autopilot.schema';
import {
  cancelAutopilotAction,
  confirmAutopilotAction,
  pauseAutopilotAction,
  resumeAutopilotAction,
  startAutopilotAction,
  updateAutopilotAction,
} from '../../_lib/server/autopilot-actions';
import { AutopilotLive } from './autopilot-live';

// « Me montrer les 3 premiers formulaires avant d'envoyer » : option masquée pour l'instant (ménage du
// 10/11/2026, choix de Gabriel) ; repasser à `true` pour la réafficher (et la recocher par défaut à la 1re campagne)
const SHOW_PREVIEW_OPTION = false;

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
  /** « Prénom Nom · Société » de l'expéditeur, pour la confirmation du lancement (null : pas d'expéditeur) */
  senderLabel: string | null;
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
    void queryClient.invalidateQueries({ queryKey: ['lm-autopilot-live'] });
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
        senderLabel={props.senderLabel}
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
      senderLabel={props.senderLabel ?? null}
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
  senderLabel: string | null;
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
      preview: SHOW_PREVIEW_OPTION && !summary.contacted_before,
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
  // lancement en attente de confirmation (analyse UX V-01 : un message envoyé en son nom ne se rattrape pas)
  const [confirming, setConfirming] = useState<SetupValues | null>(null);

  const toSettings = (input: SetupValues) => ({
    target: clamp(input.target),
    messages: input.messages,
    schedule: input.schedule,
    spreadDays: clampSpread(input.spreadDays),
  });

  const launch = (input: SetupValues) => {
    setConfirming(null);
    start.execute({
      campaignId: props.campaignId,
      preview: input.preview,
      ...toSettings(input),
    });
  };

  const submit = form.handleSubmit((input) => {
    if (props.editing && summary.autopilot_id) {
      update.execute({
        autopilotId: summary.autopilot_id,
        ...toSettings(input),
      });
    } else if (input.preview) {
      // l'aperçu n'envoie rien : les 3 premiers formulaires sont montrés avant tout envoi
      launch(input);
    } else {
      setConfirming(input);
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

  const renderMessage = (message: AutopilotMessage) => {
    const checked = values.messages.includes(message.name);

    return (
      <label
        key={message.name}
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors duration-75',
          // sélection douce aux couleurs de l'appli : fond bleu pâle, filet bleu (11/11 : le noir épais était laid)
          checked
            ? 'border-brand/40 bg-brand-pale/50'
            : 'border-foreground/10 hover:bg-foreground/[0.043]',
        )}
      >
        <Checkbox
          className={'mt-0.5 shrink-0'}
          data-test={'autopilot-message'}
          checked={checked}
          onCheckedChange={() => {
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

  // Un titre de groupe n'est utile que s'il ne répète pas le nom de ses messages (ménage du 10/11/2026 :
  // « Couvreurs et charpentiers » apparaissait deux fois) ; sans titre utile, une seule grille sur deux colonnes
  const sectionTitle = (section: (typeof messageSections)[number]) => {
    const title = section.heading ?? t('messages.othersHeading');

    return section.messages.every((message) => sameLabel(message.name, title))
      ? null
      : title;
  };
  const showSectionTitles =
    props.perGroup && messageSections.some((section) => sectionTitle(section));

  const messagesList = showSectionTitles ? (
    messageSections.map((section) => (
      <div
        key={section.heading ?? '-'}
        className={'flex flex-col gap-2'}
        data-test={'autopilot-message-section'}
      >
        {sectionTitle(section) ? (
          <h4 className={'text-muted-foreground text-sm font-medium'}>
            {sectionTitle(section)}
          </h4>
        ) : null}

        <div className={'grid grid-cols-1 gap-2.5 sm:grid-cols-2'}>
          {section.messages.map(renderMessage)}
        </div>
      </div>
    ))
  ) : (
    <div className={'grid grid-cols-1 gap-2.5 sm:grid-cols-2'}>
      {messageSections.flatMap((section) =>
        section.messages.map(renderMessage),
      )}
    </div>
  );

  const messagesSummary =
    props.messages.length === 0
      ? t('panel.noMessage')
      : values.messages.length === 1
        ? values.messages[0]
        : t('panel.messagesCount', { count: values.messages.length });

  // Refait le 10/11/2026 sur le modèle de « Text to Speech » d'ElevenLabs : à gauche l'essentiel (combien
  // d'entreprises, lancer), à droite un panneau « Réglages » en lignes compactes ; la liste des messages s'ouvre
  // dans une fenêtre au lieu d'occuper la page.
  return (
    <form
      onSubmit={submit}
      className={
        'grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]'
      }
      data-test={'autopilot-setup'}
    >
      <section
        className={
          'bg-card ring-foreground/10 flex min-w-0 flex-col gap-5 rounded-2xl p-6 ring-1'
        }
      >
        <h2 className={'font-heading text-xl font-medium tracking-[-0.01em]'}>
          {t('question')}
        </h2>

        <div className={'flex items-center gap-3'}>
          <Button
            type={'button'}
            variant={'outline'}
            size={'icon'}
            className={'size-12 rounded-xl'}
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
              'font-heading text-primary border-foreground/10 bg-background h-12 w-44 rounded-xl border px-2 text-center text-4xl font-normal tabular-nums sm:w-56'
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
            className={'size-12 rounded-xl'}
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

        {props.editing || !SHOW_PREVIEW_OPTION ? null : (
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

        <div
          className={
            'flex flex-wrap items-center justify-end gap-3 border-t pt-5'
          }
        >
          {props.onCancelEdit ? (
            <Button
              type={'button'}
              variant={'ghost'}
              size={'lg'}
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
      </section>

      <aside
        className={
          'bg-card ring-foreground/10 flex flex-col gap-5 rounded-2xl p-5 ring-1'
        }
        data-test={'autopilot-settings'}
      >
        <h3 className={'text-[15px] font-medium'}>{t('panel.title')}</h3>

        <div className={'flex flex-col gap-2'} data-test={'autopilot-schedule'}>
          <span className={'text-sm font-medium'}>{t('pace.title')}</span>

          <NativeSelect
            className={panelSelectClasses}
            data-test={'autopilot-pace'}
            value={values.schedule}
            onChange={(event) =>
              form.setValue('schedule', event.target.value as AutopilotSchedule)
            }
          >
            {(['office', 'spread', 'continuous'] as const).map((schedule) => (
              <NativeSelectOption key={schedule} value={schedule}>
                {t(`pace.${schedule}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          {values.schedule === 'spread' ? (
            <label
              className={
                'text-muted-foreground flex items-center gap-2 text-sm'
              }
            >
              <span>{t('pace.spreadOver')}</span>

              <Input
                type={'number'}
                inputMode={'numeric'}
                min={SPREAD_MIN}
                max={SPREAD_MAX}
                step={1}
                className={'h-8 w-16 tabular-nums'}
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
        </div>

        {props.senderSection}

        <div className={'flex flex-col gap-2'}>
          <div className={'flex items-center justify-between gap-2'}>
            <span className={'text-sm font-medium'}>{t('panel.messages')}</span>

            <Link href={props.writeHref} className={panelLinkClasses}>
              {t('panel.edit')}
            </Link>
          </div>

          <Dialog>
            <DialogTrigger
              disabled={props.messages.length === 0}
              render={
                <button
                  type={'button'}
                  className={panelSelectorClasses}
                  data-test={'autopilot-messages-open'}
                />
              }
            >
              <span className={'min-w-0 truncate'}>{messagesSummary}</span>
              <ChevronRight
                className={'text-muted-foreground size-4 shrink-0'}
              />
            </DialogTrigger>

            <DialogContent
              className={'max-h-[85vh] overflow-y-auto sm:max-w-3xl'}
            >
              <DialogHeader>
                <DialogTitle>{t('messages.title')}</DialogTitle>
              </DialogHeader>

              {messagesList}

              <DialogFooter>
                <DialogClose render={<Button />}>{t('panel.done')}</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </aside>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
          }
        }}
      >
        <DialogContent data-test={'autopilot-confirm'}>
          <DialogHeader>
            <DialogTitle>{t('confirm.title')}</DialogTitle>
          </DialogHeader>

          {confirming ? (
            <dl className={'flex flex-col gap-3 text-sm'}>
              <ConfirmRow label={t('confirm.count')}>
                {t('confirm.countValue', { count: clamp(confirming.target) })}
              </ConfirmRow>
              <ConfirmRow label={t('confirm.sender')}>
                {props.senderLabel ?? '—'}
              </ConfirmRow>
              <ConfirmRow label={t('confirm.messages')}>
                {confirming.messages.length === 1
                  ? confirming.messages[0]
                  : t('confirm.messagesValue', {
                      count: confirming.messages.length,
                      names: confirming.messages.join(', '),
                    })}
              </ConfirmRow>
              <ConfirmRow label={t('confirm.when')}>
                {confirming.schedule === 'spread'
                  ? t('confirm.spreadValue', {
                      count: clampSpread(confirming.spreadDays),
                    })
                  : t(`pace.${confirming.schedule}`)}
              </ConfirmRow>
            </dl>
          ) : null}

          <p className={'text-muted-foreground text-sm'}>{t('confirm.note')}</p>

          <DialogFooter>
            <DialogClose
              render={<Button variant={'outline'} />}
              data-test={'autopilot-confirm-cancel'}
            >
              {t('confirm.cancel')}
            </DialogClose>
            <Button
              type={'button'}
              data-test={'autopilot-confirm-launch'}
              onClick={() => {
                if (confirming) {
                  launch(confirming);
                }
              }}
            >
              {t('confirm.launch')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function ConfirmRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className={'flex flex-col gap-0.5 sm:flex-row sm:gap-3'}>
      <dt className={'text-muted-foreground shrink-0 sm:w-36'}>
        {props.label}
      </dt>
      <dd className={'text-foreground font-medium'}>{props.children}</dd>
    </div>
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
      className={cn(chipClasses(props.selected), 'tabular-nums')}
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
          size={'lg'}
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
  /** expéditeur en clair, pour le détail d'un envoi */
  senderLabel: string | null;
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

  const title = done
    ? summary.finished_reason === 'no_prospects'
      ? t('doneNoProspects', { count: summary.sent })
      : t('doneTitle', { count: summary.sent })
    : paused
      ? t('paused')
      : t('running');

  const progress = target > 0 ? Math.min(1, summary.sent / target) : 0;

  return (
    <div className={'flex flex-col gap-4'} data-test={'autopilot-running'}>
      <div className={'flex flex-wrap items-center justify-between gap-3'}>
        <div className={'flex items-center gap-2.5'}>
          <span
            aria-hidden
            className={cn(
              'size-2.5 rounded-full',
              done
                ? 'bg-ok'
                : paused
                  ? 'bg-muted-foreground/50'
                  : 'bg-ok animate-pulse',
            )}
          />

          <span
            className={'text-[15px] font-medium'}
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
              <Play />
              {t('resume')}
            </Button>
          ) : (
            <Button
              variant={'outline'}
              loading={pause.isPending}
              data-test={'autopilot-pause'}
              onClick={() => pause.execute({ autopilotId })}
            >
              <Pause />
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

      {noPlan ? (
        <Alert className={alertExtras.warning} data-test={'autopilot-no-plan'}>
          <TriangleAlert className={'h-4'} />
          <AlertDescription
            className={'flex flex-wrap items-center justify-between gap-2'}
          >
            <span>{t('noPlan')}</span>

            <Button
              nativeButton={false}
              render={<Link href={props.billingHref} />}
            >
              {t('billing')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {waitingWindow && nextSend ? (
        <p
          className={'text-muted-foreground flex items-center gap-2 text-sm'}
          data-test={'autopilot-next-send'}
        >
          <Clock className={'size-4 shrink-0'} />
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

      <div
        className={
          'bg-card ring-foreground/10 overflow-hidden rounded-2xl ring-1'
        }
      >
        <KpiStrip>
          <Kpi
            label={t('sent')}
            value={
              <>
                {format.number(summary.sent)}
                <span className={'text-muted-foreground'}>
                  {' '}
                  / {format.number(target)}
                </span>
              </>
            }
            testId={'autopilot-sent'}
          />

          <Kpi
            label={t('inFlight')}
            value={format.number(done || paused ? 0 : summary.in_flight)}
            testId={'autopilot-in-flight'}
          />

          <Kpi
            label={t('aside')}
            value={format.number(summary.aside)}
            href={summary.aside > 0 ? props.advancedHref : undefined}
            testId={'autopilot-aside'}
          />

          <Kpi
            label={t('progress')}
            value={format.number(progress, {
              style: 'percent',
              maximumFractionDigits: progress > 0 && progress < 0.1 ? 1 : 0,
            })}
          />
        </KpiStrip>

        <div
          className={'bg-foreground/[0.06] h-1 overflow-hidden'}
          role={'progressbar'}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={summary.sent}
          aria-label={t('progressLabel')}
        >
          <div
            className={'bg-foreground h-full transition-all'}
            style={{ width: `${Math.round(progress * 1000) / 10}%` }}
          />
        </div>
      </div>

      <AutopilotLive
        autopilotId={autopilotId}
        live={!done && !paused}
        target={target}
        sentCount={summary.sent}
        schedule={summary.schedule}
        spreadDays={summary.spread_days}
        timezone={summary.timezone}
        startedAt={summary.started_at}
        senderLabel={props.senderLabel}
        groupHref={(group) =>
          `${props.advancedHref.replace(/&statut=[^&]*/, '')}${group === 'ready' ? '' : `&statut=${group}`}`
        }
      />
    </div>
  );
}

/** Compare deux libellés sans tenir compte des apostrophes typographiques, de la casse ni des espaces. */
function sameLabel(a: string, b: string) {
  const normalize = (value: string) =>
    value
      .normalize('NFC')
      .replace(/[\u2018\u2019\u02bc`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  return normalize(a) === normalize(b);
}
