import Link from 'next/link';

import { ArrowRight, Mail } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';

import type { CampaignResults } from '../../_lib/server/results.loader';

const versionLetter = (index: number) => String.fromCharCode(65 + index);

/**
 * Étape 5, « Résultats » : entreprises contactées sur le total à contacter, par groupe (« Un message par
 * groupe »), puis envois par version du message. Pas de réponses pour l'instant (décision du 10/11 : elles
 * arrivent dans la boîte de l'expéditeur, l'appli ne les voit pas encore).
 */
export async function ResultsStep(props: {
  results: CampaignResults;
  /** campagne triée par l'IA : le total = ses entreprises gardées */
  sorted: boolean;
  senderEmail: string | null;
  toVerifyHref: string;
  sendingHref: string;
  writeHref: string;
}) {
  const [t, format, locale] = await Promise.all([
    getTranslations('results'),
    getFormatter(),
    getLocale(),
  ]);

  const { results } = props;
  const percent =
    results.total > 0
      ? Math.min(100, Math.round((results.sent / results.total) * 100))
      : 0;

  const hasVersions =
    results.versions.length > 0 ||
    results.other.sent + results.other.toVerify > 0;

  return (
    <div className={'flex flex-col gap-4'} data-test={'campaign-step-results'}>
      <Card data-test={'campaign-results-contacted'}>
        <CardHeader>
          <CardTitle>{t('contacted.title')}</CardTitle>
          <CardDescription>
            {props.sorted
              ? t('contacted.keptHint')
              : t('contacted.websiteHint')}
          </CardDescription>
        </CardHeader>

        <CardContent className={'flex flex-col gap-3'}>
          <div className={'flex flex-wrap items-baseline gap-x-2 gap-y-1'}>
            <span
              className={
                'font-heading text-3xl font-normal tracking-[-0.02em] tabular-nums'
              }
              data-test={'campaign-results-sent'}
            >
              {format.number(results.sent)}
            </span>

            <span className={'text-muted-foreground text-sm'}>
              {t('contacted.of', {
                count: results.sent,
                total: format.number(results.total),
              })}
            </span>
          </div>

          <Progress
            value={percent}
            locale={locale}
            aria-label={t('contacted.progressLabel')}
          />

          {results.toVerify > 0 ? (
            <p
              className={'text-muted-foreground text-sm'}
              data-test={'campaign-results-to-verify'}
            >
              {t('contacted.toVerify', { count: results.toVerify })}{' '}
              <Link
                href={props.toVerifyHref}
                className={'text-brand whitespace-nowrap'}
              >
                {t('contacted.toVerifyLink')}
              </Link>
            </p>
          ) : null}

          {results.sent === 0 && results.toVerify === 0 ? (
            <div
              className={
                'flex flex-wrap items-center justify-between gap-3 pt-1'
              }
            >
              <p className={'text-muted-foreground text-sm'}>
                {t('contacted.empty')}
              </p>

              <Button
                variant={'outline'}
                size={'sm'}
                nativeButton={false}
                render={<Link href={props.sendingHref} />}
              >
                <span>{t('contacted.goToSending')}</span>
                <ArrowRight className={'w-4'} />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {results.byGroup && results.byGroup.length > 0 ? (
        <Card data-test={'campaign-results-groups'}>
          <CardHeader>
            <CardTitle>{t('byGroup.title')}</CardTitle>
            <CardDescription>{t('byGroup.description')}</CardDescription>
          </CardHeader>

          <CardContent>
            <ul className={'divide-border flex flex-col divide-y'}>
              {results.byGroup.map((group) => (
                <li
                  key={group.key ?? '-'}
                  className={
                    'flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4'
                  }
                  data-test={'campaign-results-group'}
                >
                  <span className={'min-w-0 text-sm font-medium sm:w-48'}>
                    {group.label ?? t('byGroup.outside')}
                  </span>

                  <div className={'flex min-w-0 flex-1 items-center gap-3'}>
                    <Progress
                      className={'flex-1'}
                      value={
                        group.kept > 0
                          ? Math.min(
                              100,
                              Math.round((group.sent / group.kept) * 100),
                            )
                          : 0
                      }
                      locale={locale}
                      aria-label={group.label ?? t('byGroup.outside')}
                    />

                    <span
                      className={
                        'shrink-0 text-sm font-medium whitespace-nowrap tabular-nums'
                      }
                    >
                      {t('byGroup.sentOf', {
                        sent: group.sent,
                        kept: group.kept,
                      })}
                    </span>
                  </div>

                  {group.toVerify > 0 ? (
                    <span
                      className={
                        'text-muted-foreground shrink-0 text-sm tabular-nums'
                      }
                    >
                      {t('versions.toVerify', { count: group.toVerify })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card data-test={'campaign-results-versions'}>
        <CardHeader>
          <CardTitle>{t('versions.title')}</CardTitle>
          <CardDescription>{t('versions.description')}</CardDescription>
        </CardHeader>

        <CardContent>
          {hasVersions ? (
            <ul className={'divide-border flex flex-col divide-y'}>
              {results.versions.map((version) => (
                <VersionRow
                  key={version.key}
                  group={
                    version.group === null
                      ? null
                      : version.group || t('versions.others')
                  }
                  label={t('versions.version', {
                    letter: versionLetter(version.index),
                  })}
                  preview={version.preview}
                  sent={t('versions.sent', { count: version.sent })}
                  toVerify={
                    version.toVerify > 0
                      ? t('versions.toVerify', { count: version.toVerify })
                      : null
                  }
                />
              ))}

              {results.other.sent + results.other.toVerify > 0 ? (
                <VersionRow
                  label={t('versions.other')}
                  preview={null}
                  sent={t('versions.sent', { count: results.other.sent })}
                  toVerify={
                    results.other.toVerify > 0
                      ? t('versions.toVerify', {
                          count: results.other.toVerify,
                        })
                      : null
                  }
                />
              ) : null}
            </ul>
          ) : (
            <div
              className={'flex flex-wrap items-center justify-between gap-3'}
            >
              <p className={'text-muted-foreground text-sm'}>
                {t('versions.empty')}
              </p>

              <Button
                variant={'outline'}
                size={'sm'}
                nativeButton={false}
                render={<Link href={props.writeHref} />}
              >
                <span>{t('versions.goToMessage')}</span>
                <ArrowRight className={'w-4'} />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <p
        className={'text-muted-foreground flex items-start gap-2 text-sm'}
        data-test={'campaign-results-replies-note'}
      >
        <Mail className={'mt-0.5 size-4 shrink-0'} />
        <span>
          {props.senderEmail
            ? t('replies.withEmail', { email: props.senderEmail })
            : t('replies.withoutEmail')}
        </span>
      </p>
    </div>
  );
}

function VersionRow(props: {
  /** « Un message par groupe » : groupe de la version (petit badge devant son nom) */
  group?: string | null;
  label: string;
  preview: string | null;
  sent: string;
  toVerify: string | null;
}) {
  return (
    <li
      className={
        'flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0'
      }
    >
      <div className={'flex min-w-0 flex-col gap-0.5'}>
        <span
          className={'flex flex-wrap items-center gap-1.5 text-sm font-medium'}
        >
          {props.group ? (
            <Badge variant={'outline'} className={'font-normal'}>
              {props.group}
            </Badge>
          ) : null}
          {props.label}
        </span>

        {props.preview ? (
          <span className={'text-muted-foreground truncate text-sm'}>
            {props.preview}
          </span>
        ) : null}
      </div>

      <div className={'flex shrink-0 flex-col items-end gap-0.5 text-sm'}>
        <span className={'font-medium tabular-nums'}>{props.sent}</span>

        {props.toVerify ? (
          <span className={'text-muted-foreground tabular-nums'}>
            {props.toVerify}
          </span>
        ) : null}
      </div>
    </li>
  );
}
