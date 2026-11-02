'use client';

import Link from 'next/link';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@kit/ui/utils';

import {
  CAMPAIGN_STEPS,
  type CampaignStep,
  type CampaignStepFacts,
  stepStates,
} from '../../_lib/steps';

/**
 * Le rail : quatre onglets dans l'ordre du parcours, chacun avec son état
 * (fait, en cours, à faire) et une ligne de résumé.
 */
export function CampaignStepsRail(props: {
  basePath: string;
  active: CampaignStep;
  facts: CampaignStepFacts;
  countryLabel: string;
  zones: number;
  categories: number;
}) {
  const t = useTranslations('campaigns.steps');
  const states = stepStates(props.facts);
  const { facts } = props;

  const subtitles: Record<CampaignStep, string> = {
    cibler:
      facts.status === 'draft'
        ? t('sub.ciblerDraft', { country: props.countryLabel })
        : t('sub.cibler', {
            country: props.countryLabel,
            zones: props.zones,
            categories: props.categories,
          }),
    trouver:
      facts.status === 'draft'
        ? t('sub.trouverTodo')
        : facts.status === 'running'
          ? t('sub.trouverRunning', { count: facts.prospects })
          : facts.status === 'paused'
            ? t('sub.trouverPaused', { count: facts.prospects })
            : t('sub.trouverDone', { count: facts.prospects }),
    rediger: !facts.hasSender
      ? t('sub.redigerNoSender')
      : facts.messagesCount === 0
        ? t('sub.redigerTodo')
        : t('sub.redigerDone', { count: facts.messagesCount }),
    contacter:
      facts.autopilot?.status === 'running' ||
      facts.autopilot?.status === 'preview'
        ? t('sub.contacterAutopilot', {
            sent: facts.autopilot.sent,
            target: facts.autopilot.target,
          })
        : facts.autopilot?.status === 'paused'
          ? t('sub.contacterAutopilotPaused', {
              sent: facts.autopilot.sent,
              target: facts.autopilot.target,
            })
          : facts.attempts.sent > 0
            ? t('sub.contacterSent', { count: facts.attempts.sent })
            : facts.attempts.ready > 0
              ? t('sub.contacterReady', { count: facts.attempts.ready })
              : facts.attempts.validated > 0
                ? t('sub.contacterValidated', {
                    count: facts.attempts.validated,
                  })
                : facts.attempts.preparing > 0
                  ? t('sub.contacterPreparing', {
                      count: facts.attempts.preparing,
                    })
                  : t('sub.contacterTodo'),
  };

  return (
    <nav
      aria-label={t('tabsLabel')}
      data-test={'campaign-steps'}
      className={
        'bg-card grid grid-cols-2 gap-1.5 rounded-xl border p-1.5 md:grid-cols-4'
      }
    >
      {CAMPAIGN_STEPS.map((step, index) => {
        const state = states[step];
        const isActive = step === props.active;

        return (
          <Link
            key={step}
            href={`${props.basePath}?etape=${step}`}
            aria-current={isActive ? 'page' : undefined}
            data-test={`campaign-step-${step}`}
            className={cn(
              'flex min-w-0 flex-col gap-1.5 rounded-lg px-3 py-2.5 transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-muted text-foreground',
            )}
          >
            <span className={'flex items-center gap-2 text-sm font-semibold'}>
              <span
                className={cn(
                  'inline-flex size-5.5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                  state === 'done'
                    ? 'bg-primary text-primary-foreground'
                    : state === 'active' || isActive
                      ? 'bg-brand text-brand-foreground'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {state === 'done' ? (
                  <Check className={'size-3.5'} strokeWidth={3} />
                ) : (
                  index + 1
                )}
              </span>

              <span className={'truncate'}>{t(step)}</span>
            </span>

            <span
              className={cn(
                'truncate text-xs',
                isActive
                  ? 'text-accent-foreground/80'
                  : 'text-muted-foreground',
              )}
            >
              {subtitles[step]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
