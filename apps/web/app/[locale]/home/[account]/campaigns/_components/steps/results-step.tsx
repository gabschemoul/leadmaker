import Link from 'next/link';

import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { Button } from '@kit/ui/button';
import { Card, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import type { CampaignResults } from '../../_lib/server/results.loader';

const versionLetter = (index: number) => String.fromCharCode(65 + index);

/**
 * Étape 5, « Résultats » — refaite le 10/11/2026 sur le modèle des pages de chiffres d'ElevenLabs :
 * une bande de chiffres clés (petit libellé gris, chiffre), puis des tableaux sobres. Aucun texte d'aide.
 * - Chiffres clés : contactées, à vérifier (lien vers les envois à vérifier), pas encore contactées, avancement.
 * - « Un message par groupe » : un tableau par groupe (le message de chaque groupe y est déjà représenté).
 * - Sinon, un tableau par version seulement s'il y a plusieurs versions à comparer.
 * Pas de réponses pour l'instant : elles arrivent dans la boîte de l'expéditeur, l'appli ne les voit pas encore.
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
  const [t, format] = await Promise.all([
    getTranslations('results'),
    getFormatter(),
  ]);

  const { results } = props;
  const share = (part: number, total: number) =>
    total > 0 ? Math.min(1, part / total) : 0;
  const percent = (value: number) =>
    // une avancée minuscule n'affiche pas « 0 % » : « < 0,1 % »
    value > 0 && value < 0.001
      ? `< ${format.number(0.001, { style: 'percent', maximumFractionDigits: 1 })}`
      : format.number(value, {
          style: 'percent',
          // une décimale sous 10 % : « 0,6 % » plutôt qu'un « 1 % » trompeur
          maximumFractionDigits: value > 0 && value < 0.1 ? 1 : 0,
        });

  const remaining = Math.max(
    0,
    results.total - results.sent - results.toVerify,
  );
  const nothingYet = results.sent === 0 && results.toVerify === 0;

  // tableau des versions : sans groupes, et seulement s'il y a de quoi comparer
  const versionRows = [
    ...results.versions.map((version) => ({
      key: String(version.key),
      label: t('versions.versionLabel', {
        letter: versionLetter(version.index),
      }),
      preview: version.preview,
      sent: version.sent,
      toVerify: version.toVerify,
    })),
    ...(results.other.sent + results.other.toVerify > 0
      ? [
          {
            key: 'other',
            label: t('versions.other'),
            preview: null,
            sent: results.other.sent,
            toVerify: results.other.toVerify,
          },
        ]
      : []),
  ];
  const showVersions = !results.byGroup && versionRows.length >= 2;

  return (
    <div className={'flex flex-col gap-4'} data-test={'campaign-step-results'}>
      <Card className={'gap-0 py-0'} data-test={'campaign-results-contacted'}>
        <div className={'bg-border grid grid-cols-2 gap-px sm:grid-cols-4'}>
          <Kpi
            label={t('kpi.contacted')}
            value={format.number(results.sent)}
            testId={'campaign-results-sent'}
          />

          <Kpi
            label={t('kpi.toVerify')}
            value={format.number(results.toVerify)}
            href={results.toVerify > 0 ? props.toVerifyHref : undefined}
            testId={'campaign-results-to-verify'}
          />

          <Kpi label={t('kpi.remaining')} value={format.number(remaining)} />

          <Kpi
            label={t('kpi.progress')}
            value={percent(share(results.sent, results.total))}
          />
        </div>

        {nothingYet ? (
          <div
            className={
              'flex flex-wrap items-center justify-between gap-3 border-t p-4'
            }
          >
            <p className={'text-muted-foreground text-sm'}>
              {t('contacted.empty')}
            </p>

            <Button
              variant={'outline'}
              nativeButton={false}
              render={<Link href={props.sendingHref} />}
            >
              <span>{t('contacted.goToSending')}</span>
              <ArrowRight />
            </Button>
          </div>
        ) : null}
      </Card>

      {results.byGroup && results.byGroup.length > 0 ? (
        <Card className={'gap-0 pb-0'} data-test={'campaign-results-groups'}>
          <CardHeader className={'pb-3'}>
            <CardTitle>{t('byGroup.title')}</CardTitle>
          </CardHeader>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={'pl-5'}>{t('byGroup.group')}</TableHead>
                <TableHead className={'text-right'}>
                  {t('byGroup.kept')}
                </TableHead>
                <TableHead className={'text-right'}>
                  {t('byGroup.contacted')}
                </TableHead>
                <TableHead className={'text-right'}>
                  {t('byGroup.toVerify')}
                </TableHead>
                <TableHead className={'w-48 pr-5'}>
                  {t('byGroup.progress')}
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {results.byGroup.map((group) => {
                const groupShare = share(group.sent, group.kept);

                return (
                  <TableRow
                    key={group.key ?? '-'}
                    data-test={'campaign-results-group'}
                  >
                    <TableCell
                      className={cn(
                        'max-w-[22rem] truncate pl-5 font-medium',
                        group.label === null && 'text-muted-foreground',
                      )}
                    >
                      {group.label ?? t('byGroup.outside')}
                    </TableCell>

                    <TableCell
                      className={
                        'text-muted-foreground text-right tabular-nums'
                      }
                    >
                      {format.number(group.kept)}
                    </TableCell>

                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        group.sent === 0 && 'text-muted-foreground',
                      )}
                    >
                      {format.number(group.sent)}
                    </TableCell>

                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        group.toVerify === 0 && 'text-muted-foreground',
                      )}
                    >
                      {format.number(group.toVerify)}
                    </TableCell>

                    <TableCell className={'pr-5'}>
                      <ShareBar
                        value={groupShare}
                        label={percent(groupShare)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {showVersions ? (
        <Card className={'gap-0 pb-0'} data-test={'campaign-results-versions'}>
          <CardHeader className={'pb-3'}>
            <CardTitle>{t('versions.title')}</CardTitle>
          </CardHeader>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={'pl-5'}>
                  {t('versions.version')}
                </TableHead>
                <TableHead className={'text-right'}>
                  {t('versions.contacted')}
                </TableHead>
                <TableHead className={'pr-5 text-right'}>
                  {t('versions.toVerify')}
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {versionRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className={'max-w-[32rem] pl-5'}>
                    <span className={'flex min-w-0 flex-col'}>
                      <span className={'font-medium'}>{row.label}</span>

                      {row.preview ? (
                        <span className={'text-muted-foreground truncate'}>
                          {row.preview}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>

                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      row.sent === 0 && 'text-muted-foreground',
                    )}
                  >
                    {format.number(row.sent)}
                  </TableCell>

                  <TableCell
                    className={cn(
                      'pr-5 text-right tabular-nums',
                      row.toVerify === 0 && 'text-muted-foreground',
                    )}
                  >
                    {format.number(row.toVerify)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

/** Tuile de chiffre clé, comme celles d'ElevenLabs : libellé gris 13 px, chiffre 18 px. */
function Kpi(props: {
  label: string;
  value: string;
  href?: string;
  testId?: string;
}) {
  const content = (
    <>
      <span
        className={
          'text-muted-foreground flex items-center gap-1 text-[13px] font-medium'
        }
      >
        {props.label}
        {props.href ? <ArrowUpRight className={'size-3.5'} /> : null}
      </span>

      <span
        className={
          'text-foreground text-[18px] leading-[26px] font-medium tabular-nums'
        }
        data-test={props.testId}
      >
        {props.value}
      </span>
    </>
  );

  const className = 'bg-card flex flex-col items-start gap-0.5 p-4';

  return props.href ? (
    <Link
      href={props.href}
      className={cn(
        className,
        'transition-colors duration-75 hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_2%)]',
      )}
    >
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** Fine barre d'avancement avec le pourcentage à droite. */
function ShareBar(props: { value: number; label: string }) {
  return (
    <span className={'flex items-center gap-3'}>
      <span
        className={
          'bg-foreground/[0.06] h-1.5 flex-1 overflow-hidden rounded-full'
        }
      >
        <span
          className={'bg-foreground block h-full rounded-full'}
          style={{
            width: `${Math.round(props.value * 1000) / 10}%`,
            // une avancée minuscule reste visible
            minWidth: props.value > 0 ? 3 : 0,
          }}
        />
      </span>

      <span
        className={
          'text-muted-foreground w-16 shrink-0 text-right whitespace-nowrap tabular-nums'
        }
      >
        {props.label}
      </span>
    </span>
  );
}
