/**
 * Rôle : étape Envoi (ex-Contacter) d'une campagne (composant serveur) : choisit entre pilote automatique et mode
 * avancé. Présentation regroupée le 10/11/2026 selon CDC-PARCOURS-TRI-ANNUAIRE §6 « Écran 4 » (planification,
 * prises de contact par jour, validation automatique, expéditeur, lancement) sans changer aucun réglage.
 * Données : props de la page campagne (compteurs de formulaires, pilote) ; expéditeurs de l'espace et expéditeur de
 * la campagne (sender.loader), droit à la validation automatique (lm_auto_validation_allowed, mode Avancé).
 * Écritures : aucune ici (déléguées à ContactAutopilot, CampaignSendingSettings, CampaignSenderSelect,
 * PrepareCampaignButton, CampaignFormsPanel).
 */

import Link from 'next/link';

import {
  Loader2,
  MessageSquareText,
  Search,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

import pathsConfig from '~/config/paths.config';
import type { AttemptGroup } from '~/lib/leadmaker/attempts';
import type { AttemptRow } from '~/lib/leadmaker/attempts-query';
import type { AutopilotSummary } from '~/lib/leadmaker/autopilot-query';

import {
  loadCampaignSender,
  loadSenders,
} from '../../../sender/_lib/server/sender.loader';
import { attemptsTotal } from '../../_lib/steps';
import { CampaignSenderSelect } from '../campaign-sender-select';
import { CampaignFormsPanel } from './campaign-forms-panel';
import { CampaignSendingSettings } from './campaign-sending-settings';
import { type AutopilotMessage, ContactAutopilot } from './contact-autopilot';
import { PrepareCampaignButton } from './prepare-campaign-button';

export type ContactMode = 'auto' | 'advanced';

/**
 * Étape 4, Envoi. Deux modes (roadmap n°18) :
 * - Pilote automatique (par défaut) : planification, expéditeur, messages, nombre d'entreprises, puis « Lancer » ;
 *   Prospectigo prépare et envoie tout seul, à son propre rythme ;
 * - Avancé : réglages d'envoi (prises de contact par jour, validation automatique) et expéditeur, puis préparer,
 *   vérifier, envoyer à la main (a/b/c) et la liste des formulaires de cette campagne par statut.
 */
export async function ContactStep(props: {
  mode: ContactMode;
  campaignId: string;
  accountId: string;
  spaceId: string;
  basePath: string;
  prospects: number;
  messagesCount: number;
  hasSender: boolean;
  dailyLimit: number;
  autoValidation: boolean;
  counts: Record<AttemptGroup, number>;
  group: AttemptGroup;
  rows: AttemptRow[];
  writeHref: string;
  discoverHref: string;
  billingHref: string;
  hasPlan: boolean;
  autopilot: AutopilotSummary | null;
  messages: AutopilotMessage[];
}) {
  const t = await getTranslations('campaigns.steps.contact');
  const tMode = await getTranslations('campaigns.autopilot.mode');
  const { counts } = props;
  const total = attemptsTotal(counts);

  const groupHref = (target: AttemptGroup) =>
    `${props.basePath}?etape=contacter&mode=avance${target === 'ready' ? '' : `&statut=${target}`}`;

  const autoHref = `${props.basePath}?etape=contacter`;
  const advancedHref = `${props.basePath}?etape=contacter&mode=avance`;

  const senderSection = (
    <ContactSender
      campaignId={props.campaignId}
      spaceId={props.spaceId}
      basePath={props.basePath}
    />
  );

  return (
    <div className={'flex flex-col gap-4'} data-test={'campaign-step-contact'}>
      <div className={'flex flex-wrap items-center justify-between gap-3'}>
        <nav
          aria-label={tMode('label')}
          className={'bg-muted inline-flex gap-1 rounded-full p-1'}
        >
          {(
            [
              ['auto', autoHref, tMode('auto')],
              ['advanced', advancedHref, tMode('advanced')],
            ] as const
          ).map(([mode, href, label]) => (
            <Link
              key={mode}
              href={href}
              aria-current={props.mode === mode ? 'page' : undefined}
              data-test={`contact-mode-${mode}`}
              className={cn(
                'flex h-8 items-center rounded-full px-4 text-sm font-medium transition-colors',
                props.mode === mode
                  ? 'bg-card text-foreground shadow-soft'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <p className={'text-muted-foreground text-sm'}>
          {props.mode === 'auto' ? tMode('autoHint') : tMode('advancedHint')}
        </p>
      </div>
      {props.prospects === 0 ? (
        <Hint
          icon={<Search className={'h-4'} />}
          text={t('noProspects')}
          href={props.discoverHref}
          label={t('goDiscover')}
          testId={'contact-no-prospects'}
        />
      ) : null}

      {props.messagesCount === 0 ? (
        <Hint
          icon={<MessageSquareText className={'h-4'} />}
          text={t('noMessage')}
          href={props.writeHref}
          label={t('writeMessage')}
          testId={'contact-no-message'}
          warning
        />
      ) : null}

      {!props.hasSender ? (
        <Hint
          icon={<TriangleAlert className={'h-4'} />}
          text={t('noSender')}
          href={props.writeHref}
          label={t('writeMessage')}
          testId={'contact-no-sender'}
          warning
        />
      ) : null}

      {props.mode === 'auto' ? (
        <ContactAutopilot
          campaignId={props.campaignId}
          initialSummary={props.autopilot}
          messages={props.messages}
          writeHref={props.writeHref}
          advancedHref={groupHref('intervention_required')}
          sendingSettingsHref={advancedHref}
          senderSection={senderSection}
          billingHref={props.billingHref}
          hasPlan={props.hasPlan}
          // le nombre de prospects contactables est vérifié par le pilote lui-même
          ready={props.messagesCount > 0 && props.hasSender}
        />
      ) : (
        <AdvancedContact
          {...props}
          total={total}
          groupHref={groupHref}
          senderSection={senderSection}
        />
      )}
    </div>
  );
}

async function AdvancedContact(
  props: Parameters<typeof ContactStep>[0] & {
    total: number;
    groupHref: (target: AttemptGroup) => string;
    senderSection: React.ReactNode;
  },
) {
  const t = await getTranslations('campaigns.steps.contact');
  const format = await getFormatter();
  const { counts, total, groupHref } = props;

  const canPrepare =
    props.prospects > 0 && props.messagesCount > 0 && props.hasSender;

  const { data: autoValidationAllowed } = await getSupabaseServerClient().rpc(
    'lm_auto_validation_allowed',
    { p_account_id: props.accountId },
  );

  return (
    <>
      {/* réglages d'envoi puis expéditeur, avant les actions a/b/c (ordre de l'écran 4 du CDC) */}
      <div className={'grid grid-cols-1 items-start gap-3 lg:grid-cols-2'}>
        <CampaignSendingSettings
          campaignId={props.campaignId}
          dailyLimit={props.dailyLimit}
          autoValidation={props.autoValidation}
          autoValidationAllowed={Boolean(autoValidationAllowed)}
          contactable={props.autopilot?.contactable ?? null}
        />

        <div className={'bg-card rounded-2xl border p-6'}>
          {props.senderSection}
        </div>
      </div>

      <div className={'grid grid-cols-1 gap-3 md:grid-cols-3'}>
        <StepCard title={t('prepareTitle')} testId={'contact-prepare-card'}>
          <Big
            value={format.number(total)}
            unit={t('prepareOf', { count: props.prospects })}
          />

          <p
            className={'text-muted-foreground flex items-center gap-2 text-sm'}
          >
            {counts.preparing > 0 ? (
              <>
                <Loader2 className={'size-4 shrink-0 animate-spin'} />
                <span>{t('prepareWorking', { count: counts.preparing })}</span>
              </>
            ) : total > 0 && total >= props.prospects ? (
              t('prepareDone')
            ) : (
              t('prepareIdle')
            )}
          </p>

          <PrepareCampaignButton
            campaignId={props.campaignId}
            disabled={!canPrepare || counts.preparing > 0}
            label={total > 0 ? t('prepareAgain') : t('prepareButton')}
          />
        </StepCard>

        <StepCard title={t('verifyTitle')} testId={'contact-verify-card'}>
          <Big
            value={format.number(counts.ready)}
            unit={t('verifyUnit', { count: counts.ready })}
          />

          <p className={'text-muted-foreground text-sm'}>
            {counts.incomplete > 0 || counts.intervention_required > 0
              ? t('verifyDetail', {
                  incomplete: counts.incomplete,
                  captcha: counts.intervention_required,
                })
              : t('verifyIdle')}
          </p>

          {counts.ready > 0 ? (
            <Button
              nativeButton={false}
              className={'mt-auto'}
              data-test={'contact-verify-button'}
              render={<Link href={groupHref('ready')} />}
            >
              {t('verifyButton')}
            </Button>
          ) : (
            <Button
              disabled
              className={'mt-auto'}
              data-test={'contact-verify-button'}
            >
              {t('verifyButton')}
            </Button>
          )}
        </StepCard>

        <StepCard title={t('sendTitle')} testId={'contact-send-card'}>
          <Big
            value={format.number(counts.sent)}
            unit={t('sendUnit', { count: counts.sent })}
          />

          <p className={'text-muted-foreground text-sm'}>
            {t('sendDetail', {
              validated: counts.validated,
              toVerify: counts.to_verify,
            })}
          </p>

          <p className={'text-muted-foreground text-sm'}>
            {props.autoValidation
              ? t('sendAutoValidation')
              : t('sendAuto', { limit: props.dailyLimit })}
          </p>
        </StepCard>
      </div>

      <CampaignFormsPanel
        campaignId={props.campaignId}
        spaceId={props.spaceId}
        accountId={props.accountId}
        counts={counts}
        initialGroup={props.group}
        initialRows={props.rows}
        total={total}
      />
    </>
  );
}

/**
 * Section « Qui envoie ? » de l'étape Envoi : l'expéditeur de la campagne (choisi, sinon celui par défaut de
 * l'espace), le lien vers sa fiche et, s'il y en a plusieurs, le choix de l'expéditeur (CampaignSenderSelect,
 * même composant et même action que dans l'étape « Votre message »).
 */
async function ContactSender(props: {
  campaignId: string;
  spaceId: string;
  basePath: string;
}) {
  const t = await getTranslations('campaigns.steps.write');
  const client = getSupabaseServerClient();

  const [sender, senders] = await Promise.all([
    loadCampaignSender(client, props.campaignId),
    loadSenders(client, props.spaceId),
  ]);

  // basePath = `${accountCampaigns}/${id}` (paths.config) : on en retire le slug de l'équipe pour viser la page
  // Expéditeur du même compte, comme la page campagne (senderHref)
  const [before = '', after = ''] =
    pathsConfig.app.accountCampaigns.split('[account]');
  const campaignsPath = props.basePath.slice(
    0,
    props.basePath.lastIndexOf('/'),
  );
  const slug = campaignsPath.slice(
    before.length,
    campaignsPath.length - after.length,
  );
  const senderHref = `${pathsConfig.app.accountSender.replace('[account]', slug)}?space=${props.spaceId}${sender ? `&sender=${sender.id}` : ''}`;

  return (
    <section
      className={'flex flex-col gap-4 text-sm'}
      data-test={'contact-sender'}
    >
      <h3 className={'text-base font-medium'}>{t('senderTitle')}</h3>

      <div className={'flex flex-wrap items-center justify-between gap-3'}>
        {sender ? (
          <div className={'flex min-w-0 items-center gap-3'}>
            <span
              className={
                'bg-accent text-accent-foreground inline-flex size-10 shrink-0 items-center justify-center rounded-full font-medium'
              }
            >
              {`${sender.first_name.charAt(0)}${sender.last_name.charAt(0)}`.toUpperCase()}
            </span>

            <div className={'flex min-w-0 flex-col'}>
              <span className={'truncate font-medium'}>
                {sender.first_name} {sender.last_name} · {sender.company}
              </span>
              <span className={'text-muted-foreground truncate'}>
                {[sender.email, sender.phone].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
        ) : (
          <div className={'text-muted-foreground flex items-center gap-3'}>
            <UserRound className={'size-5'} />
            <span>{t('senderMissing')}</span>
          </div>
        )}

        <Button
          variant={sender ? 'outline' : 'default'}
          size={'sm'}
          nativeButton={false}
          data-test={'contact-sender-link'}
          render={<Link href={senderHref} />}
        >
          {sender ? t('senderEdit') : t('senderFill')}
        </Button>
      </div>

      {senders.length > 1 ? (
        <CampaignSenderSelect
          campaignId={props.campaignId}
          senders={senders.map(
            ({ id, first_name, last_name, company, is_default }) => ({
              id,
              first_name,
              last_name,
              company,
              is_default,
            }),
          )}
          // la page campagne passe lm_campaigns.sender_id ; ici on le déduit de l'expéditeur retenu
          // (celui par défaut = « Par défaut », même affichage)
          chosenSenderId={sender && !sender.is_default ? sender.id : null}
        />
      ) : null}
    </section>
  );
}

function Hint(props: {
  icon: React.ReactNode;
  text: string;
  href: string;
  label: string;
  testId: string;
  warning?: boolean;
}) {
  return (
    <Alert
      className={props.warning ? alertExtras.warning : undefined}
      data-test={props.testId}
    >
      {props.icon}

      <AlertDescription
        className={'flex flex-wrap items-center justify-between gap-2'}
      >
        <span>{props.text}</span>

        <Button
          size={'sm'}
          nativeButton={false}
          render={<Link href={props.href} />}
        >
          {props.label}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function StepCard(
  props: React.PropsWithChildren<{ title: string; testId: string }>,
) {
  return (
    <Card data-test={props.testId}>
      <CardHeader className={'pb-2'}>
        <CardTitle
          className={
            'text-muted-foreground text-xs font-medium tracking-wider uppercase'
          }
        >
          {props.title}
        </CardTitle>
      </CardHeader>

      <CardContent className={'flex h-full flex-col gap-3'}>
        {props.children}
      </CardContent>
    </Card>
  );
}

function Big(props: { value: string; unit: string }) {
  return (
    <div className={'flex items-baseline gap-2'}>
      <span
        className={
          'font-heading text-3xl font-normal tracking-[-0.02em] tabular-nums'
        }
      >
        {props.value}
      </span>
      <span className={'text-muted-foreground text-sm'}>{props.unit}</span>
    </div>
  );
}
