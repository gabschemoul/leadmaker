'use client';

/**
 * Rôle : « À vous de jouer » de l'étape Envoi (un seul écran depuis le 12/11/2026, maquette validée par Gabriel) :
 * l'encart des trois listes qui attendent l'utilisateur (formulaires à vérifier, sites protégés contre les robots,
 * cases à compléter) et l'écran qui les montre un par un (capture du formulaire rempli, message, décision).
 * Données : lm_campaign_todo / lm_campaign_todo_ids et le formulaire courant (~/lib/leadmaker/todo-query), lus par
 * la RLS ; compteurs relus toutes les quelques secondes pendant un envoi.
 * Écritures : approveTodoAction, markSentByHandAction, skipTodoAction (envoi-actions.ts).
 */
import { createContext, use, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, ImageOff } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Spinner } from '@kit/ui/spinner';
import { cn } from '@kit/ui/utils';

import { extraValues, missingLabels } from '~/lib/leadmaker/attempts';
import { displayHost } from '~/lib/leadmaker/autopilot-query';
import {
  type CampaignTodo,
  TODO_KINDS,
  type TodoItem,
  type TodoKind,
  fetchCampaignTodo,
  fetchTodoIds,
  fetchTodoItem,
} from '~/lib/leadmaker/todo-query';
import { websiteHref } from '~/lib/leadmaker/website';

import {
  approveTodoAction,
  markSentByHandAction,
  skipTodoAction,
} from '../../_lib/server/envoi-actions';
import { ProspectBadge } from './autopilot-live';

/** Relecture des compteurs pendant un envoi, et au repos. */
const POLL_LIVE_MS = 5_000;
const POLL_IDLE_MS = 30_000;

/** Pastille du nombre de chaque liste (couleurs de la maquette). */
const KIND_TINTS: Record<TodoKind, string> = {
  to_check: 'bg-brand-pale text-brand-hover dark:text-brand',
  captcha: 'bg-[#fdf0e3] text-[#c2410c] dark:bg-[#c2410c]/15',
  unknown_field: 'bg-[#fdf6e9] text-[#a16207] dark:bg-[#a16207]/15',
};

interface TodoContextValue {
  counts: CampaignTodo;
  total: number;
  open: (kind: TodoKind) => void;
  skipAll: (kind: TodoKind) => void;
}

const TodoContext = createContext<TodoContextValue | null>(null);

/** Compteurs « À vous de jouer » de la campagne (0 hors de l'étape Envoi). */
export function useEnvoiTodo() {
  return use(TodoContext);
}

/**
 * Enveloppe de l'étape Envoi : fournit les compteurs à l'encart et aux chiffres du pilote, et remplace l'étape par
 * l'écran « un par un » quand l'utilisateur ouvre une liste.
 */
export function EnvoiTodoProvider(
  props: React.PropsWithChildren<{
    campaignId: string;
    accountId: string;
    /** un envoi est en cours : compteurs relus plus souvent */
    live: boolean;
  }>,
) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const t = useTranslations('campaigns.envoi');
  const tAll = useTranslations();
  const [reviewing, setReviewing] = useState<TodoKind | null>(null);
  const [skipping, setSkipping] = useState<TodoKind | null>(null);

  const todoKey = ['lm-campaign-todo', props.campaignId];

  const { data: counts = { to_check: 0, captcha: 0, unknown_field: 0 } } =
    useQuery({
      queryKey: todoKey,
      queryFn: () => fetchCampaignTodo(client, props.campaignId),
      refetchInterval: props.live ? POLL_LIVE_MS : POLL_IDLE_MS,
    });

  const total = counts.to_check + counts.captcha + counts.unknown_field;

  // la liste de l'écran « un par un » n'est pas relue pendant qu'on la parcourt (position stable)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['lm-campaign-todo'] });
    void queryClient.invalidateQueries({ queryKey: ['lm-autopilot'] });
    void queryClient.invalidateQueries({ queryKey: ['lm-autopilot-live'] });
  };

  const skip = useAction(skipTodoAction, {
    onSuccess: ({ data }) => {
      toast.success(t('skipAll.done', { count: data?.count ?? 0 }));
      setSkipping(null);
      refresh();
    },
    onError: ({ error }) =>
      toast.error(tAll(error.serverError ?? 'campaigns.envoi.errors.generic')),
  });

  // la liste est relue à chaque ouverture (puis figée pendant qu'on la parcourt)
  const open = (kind: TodoKind) => {
    queryClient.removeQueries({
      queryKey: ['lm-todo-ids', props.campaignId, kind],
    });
    setReviewing(kind);
  };

  return (
    <TodoContext
      value={{
        counts,
        total,
        open,
        skipAll: setSkipping,
      }}
    >
      {reviewing ? (
        <TodoReview
          key={reviewing}
          kind={reviewing}
          campaignId={props.campaignId}
          accountId={props.accountId}
          onChanged={refresh}
          onBack={() => {
            setReviewing(null);
            refresh();
          }}
        />
      ) : null}

      {/* l'étape reste montée pendant l'écran « un par un » (une modification en cours n'est pas perdue) */}
      <div hidden={reviewing !== null}>{props.children}</div>

      <AlertDialog
        open={skipping !== null}
        onOpenChange={(open) => (open ? null : setSkipping(null))}
      >
        <AlertDialogContent data-test={'envoi-skip-all-dialog'}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {skipping
                ? t(`skipAll.title.${skipping}`, { count: counts[skipping] })
                : null}
            </AlertDialogTitle>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={skip.isPending}>
              {t('skipAll.cancel')}
            </AlertDialogCancel>

            <Button
              type={'button'}
              loading={skip.isPending}
              data-test={'envoi-skip-all-confirm'}
              onClick={() =>
                skipping
                  ? skip.execute({
                      accountId: props.accountId,
                      campaignId: props.campaignId,
                      kind: skipping,
                    })
                  : null
              }
            >
              {t('skipAll.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TodoContext>
  );
}

/** L'encart « À vous de jouer » : une ligne par liste non vide (rien s'il n'y a rien à faire). */
export function TodoCard() {
  const t = useTranslations('campaigns.envoi');
  const format = useFormatter();
  const todo = useEnvoiTodo();

  if (!todo || todo.total === 0) {
    return null;
  }

  return (
    <section
      className={
        'bg-card ring-brand flex flex-col rounded-2xl px-5 pt-5 pb-2 ring-[1.5px]'
      }
      data-test={'envoi-todo'}
    >
      <h3 className={'mb-2 text-[15px] font-medium'}>{t('todo.title')}</h3>

      <ul className={'flex flex-col'}>
        {TODO_KINDS.filter((kind) => todo.counts[kind] > 0).map((kind) => (
          <li
            key={kind}
            className={
              'border-foreground/[0.07] flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-3.5 sm:flex-nowrap'
            }
            data-test={`envoi-todo-${kind}`}
          >
            <span
              className={cn(
                'flex h-10 min-w-10 shrink-0 items-center justify-center rounded-xl px-2 text-[15px] font-semibold tabular-nums',
                KIND_TINTS[kind],
              )}
            >
              {format.number(todo.counts[kind])}
            </span>

            <span className={'flex min-w-0 flex-1 flex-col gap-0.5'}>
              <span className={'text-[15px] font-medium'}>
                {t(`todo.${kind}.title`)}
              </span>
              <span className={'text-muted-foreground text-[13px]'}>
                {t(`todo.${kind}.hint`)}
              </span>
            </span>

            <span className={'flex shrink-0 items-center gap-2'}>
              <Button
                variant={'ghost'}
                size={'sm'}
                className={'text-muted-foreground'}
                data-test={`envoi-skip-all-${kind}`}
                onClick={() => todo.skipAll(kind)}
              >
                {t('skipAll.button')}
              </Button>

              <Button
                data-test={`envoi-open-${kind}`}
                onClick={() => todo.open(kind)}
              >
                {t(`todo.${kind}.cta`)}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Un par un                                                           */
/* ------------------------------------------------------------------ */

function TodoReview(props: {
  kind: TodoKind;
  campaignId: string;
  accountId: string;
  onChanged: () => void;
  onBack: () => void;
}) {
  const t = useTranslations('campaigns.envoi');
  const tAll = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const client = useSupabase();
  // formulaires déjà traités dans cet écran (la liste est lue une fois, à l'ouverture)
  const [handled, setHandled] = useState<string[]>([]);

  const ids = useQuery({
    queryKey: ['lm-todo-ids', props.campaignId, props.kind],
    queryFn: () => fetchTodoIds(client, props.campaignId, props.kind),
    staleTime: Infinity,
  });

  const all = ids.data ?? [];
  const queue = all.filter((id) => !handled.includes(id));
  const current = queue[0] ?? null;
  const next = queue[1] ?? null;

  const itemQuery = (id: string) => ({
    queryKey: ['lm-todo-item', id, locale],
    queryFn: () => fetchTodoItem(client, id, locale),
    staleTime: 5 * 60_000,
  });

  const item = useQuery({ ...itemQuery(current ?? ''), enabled: !!current });
  // le suivant se charge pendant qu'on regarde celui-ci
  useQuery({ ...itemQuery(next ?? ''), enabled: !!next });

  const advance = (id: string) => {
    props.onChanged();

    if (queue.length <= 1) {
      toast.success(t('review.allDone'));
      props.onBack();
      return;
    }

    setHandled((list) => [...list, id]);
  };

  // déjà traité ailleurs (autre onglet, autre membre, robot) : on le dit et on passe au suivant
  const onError = ({
    error,
    input,
  }: {
    error: { serverError?: string };
    input: { id?: string };
  }) => {
    toast.error(tAll(error.serverError ?? 'campaigns.envoi.errors.generic'));

    if (error.serverError === 'campaigns.envoi.errors.gone' && input.id) {
      advance(input.id);
    }
  };

  const approve = useAction(approveTodoAction, {
    onSuccess: ({ input }) => advance(input.id),
    onError,
  });
  const markSent = useAction(markSentByHandAction, {
    onSuccess: ({ input }) => advance(input.id),
    onError,
  });
  const skip = useAction(skipTodoAction, {
    onSuccess: ({ input }) => (input.id ? advance(input.id) : undefined),
    onError,
  });

  const pending = approve.isPending || markSent.isPending || skip.isPending;

  const header = (
    <div className={'flex flex-wrap items-center justify-between gap-3'}>
      <Button
        variant={'ghost'}
        className={'text-muted-foreground -ml-2.5'}
        data-test={'envoi-review-back'}
        onClick={props.onBack}
      >
        <ArrowLeft />
        {t('review.back')}
      </Button>

      {all.length > 0 ? (
        <div
          className={'text-muted-foreground flex items-center gap-3 text-sm'}
        >
          <span className={'text-foreground font-medium'}>
            {t(`todo.${props.kind}.title`)}
          </span>
          <span className={'tabular-nums'} data-test={'envoi-review-position'}>
            {t('review.position', {
              index: format.number(handled.length + 1),
              total: format.number(all.length),
            })}
          </span>
          <span
            className={
              'bg-foreground/[0.08] hidden h-1 w-40 overflow-hidden rounded-full sm:block'
            }
          >
            <span
              className={'bg-foreground block h-full rounded-full'}
              style={{
                width: `${Math.max(2, (handled.length / all.length) * 100)}%`,
              }}
            />
          </span>
        </div>
      ) : null}
    </div>
  );

  if (ids.isPending || (current && item.isPending)) {
    return (
      <div className={'flex flex-col gap-5'} data-test={'envoi-review'}>
        {header}
        <div className={'flex h-80 items-center justify-center'}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (!current) {
    // liste vide (déjà traitée ailleurs) : retour à l'étape
    return (
      <div className={'flex flex-col gap-5'} data-test={'envoi-review'}>
        {header}
        <div className={'flex h-60 flex-col items-center justify-center gap-4'}>
          <p className={'text-muted-foreground'}>{t('review.empty')}</p>
          <Button onClick={props.onBack}>{t('review.back')}</Button>
        </div>
      </div>
    );
  }

  const data = item.data ?? null;

  return (
    <div className={'flex flex-col gap-5'} data-test={'envoi-review'}>
      {header}

      {data === null ? (
        <div
          className={
            'bg-card ring-foreground/10 flex h-60 flex-col items-center justify-center gap-4 rounded-2xl ring-1'
          }
        >
          <p className={'text-muted-foreground'}>{t('errors.gone')}</p>
          <Button onClick={() => advance(current)}>{t('review.next')}</Button>
        </div>
      ) : (
        <ReviewItem
          key={data.id}
          kind={props.kind}
          item={data}
          pending={pending}
          approving={approve.isPending}
          markingSent={markSent.isPending}
          skipping={skip.isPending}
          onSkip={() =>
            skip.execute({
              accountId: props.accountId,
              campaignId: props.campaignId,
              kind: props.kind,
              id: data.id,
            })
          }
          onApprove={(values) =>
            approve.execute({
              accountId: props.accountId,
              id: data.id,
              extraValues: values,
            })
          }
          onSentByHand={() =>
            markSent.execute({ accountId: props.accountId, id: data.id })
          }
        />
      )}
    </div>
  );
}

function ReviewItem(props: {
  kind: TodoKind;
  item: TodoItem;
  pending: boolean;
  approving: boolean;
  markingSent: boolean;
  skipping: boolean;
  onSkip: () => void;
  onApprove: (extra?: Array<{ label: string; value: string }>) => void;
  onSentByHand: () => void;
}) {
  const t = useTranslations('campaigns.envoi.review');
  const { item } = props;
  const missing = missingLabels(item.missing);
  const known = extraValues(item.extra);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(missing.map((label) => [label, known[label] ?? ''])),
  );

  const pageUrl = item.form_url ?? item.prospect.website;
  const pageHref = websiteHref(pageUrl);
  const message = [item.subject, item.body].filter(Boolean).join('\n\n');
  const filled =
    props.kind !== 'unknown_field' ||
    missing.every((label) => (values[label] ?? '').trim() !== '');

  const copy = () => {
    void navigator.clipboard
      .writeText(message)
      .then(() => toast.success(t('copied')))
      .catch(() => toast.error(t('copyFailed')));
  };

  return (
    <div
      className={
        'grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px]'
      }
    >
      <figure
        className={
          'bg-card ring-foreground/10 flex min-w-0 flex-col overflow-hidden rounded-2xl ring-1'
        }
      >
        <div
          className={
            'bg-muted/60 border-foreground/[0.08] flex h-10 items-center gap-2 border-b px-3.5'
          }
        >
          <span
            aria-hidden
            className={'bg-foreground/15 size-2.5 rounded-full'}
          />
          <span
            aria-hidden
            className={'bg-foreground/15 size-2.5 rounded-full'}
          />
          <span
            aria-hidden
            className={'bg-foreground/15 size-2.5 rounded-full'}
          />
          <span
            className={
              'bg-card text-muted-foreground ml-2.5 flex h-6 min-w-0 flex-1 items-center truncate rounded-md px-2.5 text-xs'
            }
          >
            {displayHost(pageUrl)}
          </span>
        </div>

        {item.screenshotUrl ? (
          // capture privée servie par un lien signé : pas d'optimisation d'image
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.screenshotUrl}
            alt={t('screenshotAlt', { name: item.prospect.name })}
            className={'max-h-[70vh] w-full object-contain object-top'}
            data-test={'envoi-review-screenshot'}
          />
        ) : (
          <div
            className={
              'text-muted-foreground/60 flex h-80 items-center justify-center'
            }
          >
            <ImageOff className={'size-8'} />
          </div>
        )}
      </figure>

      <div className={'flex flex-col gap-4'}>
        <section
          className={
            'bg-card ring-foreground/10 flex flex-col gap-4 rounded-2xl p-5 ring-1'
          }
        >
          <div className={'flex min-w-0 items-center gap-3'}>
            <ProspectBadge name={item.prospect.name} />

            <span className={'flex min-w-0 flex-col'}>
              <span
                className={'truncate text-base font-semibold'}
                data-test={'envoi-review-name'}
              >
                {item.prospect.name}
              </span>
              <span className={'text-muted-foreground truncate text-[13px]'}>
                {[item.activity, item.prospect.city]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </div>

          {props.kind === 'to_check' && item.detail ? (
            <p
              className={
                'rounded-xl bg-[#fdf6e9] px-3.5 py-3 text-sm text-[#92400e] dark:bg-[#a16207]/15 dark:text-[#f3c08f]'
              }
              data-test={'envoi-review-reason'}
            >
              {item.detail}
            </p>
          ) : null}

          {props.kind === 'unknown_field' && missing.length > 0 ? (
            <div className={'flex flex-col gap-3'}>
              {missing.map((label, index) => (
                <label key={label} className={'flex flex-col gap-1.5 text-sm'}>
                  <span className={'font-medium'}>{label}</span>
                  <Input
                    data-test={`envoi-review-extra-${index}`}
                    maxLength={500}
                    autoFocus={index === 0}
                    value={values[label] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [label]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : null}

          {props.kind === 'captcha' ? (
            <ol className={'flex flex-col gap-2'}>
              <CaptchaStep index={1} label={t('captcha.copyStep')}>
                <Button
                  variant={'outline'}
                  size={'sm'}
                  data-test={'envoi-review-copy'}
                  onClick={copy}
                >
                  {t('captcha.copy')}
                </Button>
              </CaptchaStep>

              <CaptchaStep index={2} label={t('captcha.openStep')}>
                {pageHref ? (
                  <Button
                    variant={'outline'}
                    size={'sm'}
                    nativeButton={false}
                    render={
                      <a href={pageHref} target={'_blank'} rel={'noreferrer'} />
                    }
                  >
                    {t('captcha.open')}
                    <ExternalLink />
                  </Button>
                ) : null}
              </CaptchaStep>
            </ol>
          ) : null}

          <div className={'flex flex-col gap-2'}>
            <span className={'text-muted-foreground text-[13px]'}>
              {t('message')}
            </span>
            <div
              className={
                'bg-brand-pale/70 max-h-72 overflow-y-auto rounded-2xl rounded-bl-sm px-4 py-3.5 text-sm leading-relaxed whitespace-pre-line'
              }
            >
              {item.subject ? (
                <p className={'mb-1.5 font-semibold'}>{item.subject}</p>
              ) : null}
              {item.body}
            </div>
          </div>
        </section>

        <div className={'flex gap-2.5'}>
          <Button
            variant={'outline'}
            size={'lg'}
            className={'flex-1'}
            disabled={props.pending}
            loading={props.skipping}
            data-test={'envoi-review-skip'}
            onClick={props.onSkip}
          >
            {t('skip')}
          </Button>

          {props.kind === 'captcha' ? (
            <Button
              size={'lg'}
              className={'flex-1'}
              disabled={props.pending}
              loading={props.markingSent}
              data-test={'envoi-review-sent-by-hand'}
              onClick={props.onSentByHand}
            >
              {t('sentByHand')}
            </Button>
          ) : (
            <Button
              size={'lg'}
              className={'flex-1'}
              disabled={props.pending || !filled}
              loading={props.approving}
              data-test={'envoi-review-send'}
              onClick={() =>
                props.onApprove(
                  props.kind === 'unknown_field'
                    ? missing.map((label) => ({
                        label,
                        value: values[label] ?? '',
                      }))
                    : undefined,
                )
              }
            >
              {t('send')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CaptchaStep(
  props: React.PropsWithChildren<{ index: number; label: string }>,
) {
  return (
    <li
      className={
        'bg-muted/60 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm'
      }
    >
      <span
        className={
          'bg-foreground text-background flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold'
        }
      >
        {props.index}
      </span>
      <span className={'min-w-0 flex-1'}>{props.label}</span>
      {props.children}
    </li>
  );
}
