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
 * Le rail : cinq onglets dans l'ordre du parcours, chacun avec son état
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
  // l'étape « Résultats » a ses textes dans son propre fichier (results.json)
  const tr = useTranslations('results.step');
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
        : typeof facts.kept === 'number'
          ? t('sub.trouverSorted', { count: facts.kept })
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
    resultats:
      facts.attempts.sent > 0
        ? tr('subSent', { count: facts.attempts.sent })
        : tr('subTodo'),
  };

  return (
    <div className={'flex flex-col gap-3'}>
      <nav
        aria-label={t('tabsLabel')}
        data-test={'campaign-steps'}
        className={
          'bg-muted inline-flex max-w-full [scrollbar-width:none] items-center gap-1 self-start overflow-x-auto rounded-full p-1'
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
              title={subtitles[step]}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-card text-foreground shadow-soft'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {state === 'done' ? (
                <Check
                  className={'text-brand size-3.5 shrink-0'}
                  strokeWidth={2.5}
                />
              ) : (
                <span className={'tabular-nums'}>{index + 1} ·</span>
              )}

              <span>{step === 'resultats' ? tr('label') : t(step)}</span>
            </Link>
          );
        })}
      </nav>

      <p
        className={'text-muted-foreground text-sm'}
        data-test={'campaign-step-summary'}
      >
        {subtitles[props.active]}
      </p>
    </div>
  );
}
