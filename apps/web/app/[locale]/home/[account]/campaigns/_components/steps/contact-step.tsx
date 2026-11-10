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
  ChevronRight,
  Loader2,
  MessageSquareText,
  Search,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

import pathsConfig from '~/config/paths.config';
import type { AttemptGroup } from '~/lib/leadmaker/attempts';
import type { AttemptRow } from '~/lib/leadmaker/attempts-query';
import type { AutopilotSummary } from '~/lib/leadmaker/autopilot-query';

import {
  panelLabelClasses,
  panelLinkClasses,
  panelSelectorClasses,
} from '../../../_components/leadmaker/panel-classes';
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
import { SendingSettingsDialog } from './sending-settings-dialog';

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
  /** « Un message par groupe » : messages rangés par groupe dans le pilote automatique */
  perGroup: boolean;
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
  const senderRow = (
    <ContactSender
      compact
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
          perGroup={props.perGroup}
          writeHref={props.writeHref}
          advancedHref={groupHref('intervention_required')}
          sendingSettingsHref={advancedHref}
          senderSection={senderRow}
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
  const { counts, total } = props;

  const canPrepare =
    props.prospects > 0 && props.messagesCount > 0 && props.hasSender;

  const { data: autoValidationAllowed } = await getSupabaseServerClient().rpc(
    'lm_auto_validation_allowed',
    { p_account_id: props.accountId },
  );

  // Mode Avancé refait le 10/11/2026 (« on ne comprend rien ») : une seule carte « Formulaires » — onglets par
  // étape façon ElevenLabs, « Réglages » (par jour, validation automatique, expéditeur) rangés dans une fenêtre,
  // « Préparer » en haut à droite. Plus de cartes a/b/c ni de texte d'explication.
  return (
    <CampaignFormsPanel
      campaignId={props.campaignId}
      spaceId={props.spaceId}
      accountId={props.accountId}
      counts={counts}
      initialGroup={props.group}
      initialRows={props.rows}
      total={total}
      actions={
        <>
          {counts.preparing > 0 ? (
            <span
              className={
                'text-muted-foreground flex items-center gap-2 text-sm'
              }
              data-test={'contact-preparing'}
            >
              <Loader2 className={'size-4 shrink-0 animate-spin'} />
              {t('preparingShort', { count: counts.preparing })}
            </span>
          ) : null}

          <SendingSettingsDialog>
            {props.senderSection}

            <div className={'border-t pt-5'}>
              <CampaignSendingSettings
                campaignId={props.campaignId}
                dailyLimit={props.dailyLimit}
                autoValidation={props.autoValidation}
                autoValidationAllowed={Boolean(autoValidationAllowed)}
                contactable={props.autopilot?.contactable ?? null}
              />
            </div>
          </SendingSettingsDialog>

          <PrepareCampaignButton
            campaignId={props.campaignId}
            disabled={!canPrepare || counts.preparing > 0}
            label={total > 0 ? t('prepareAgain') : t('prepareButton')}
          />
        </>
      }
    />
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
  /** panneau « Réglages » du pilote automatique : une ligne libellé + sélecteur, façon ElevenLabs */
  compact?: boolean;
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

  const senderOptions = senders.map(
    ({ id, first_name, last_name, company, is_default }) => ({
      id,
      first_name,
      last_name,
      company,
      is_default,
    }),
  );
  // la page campagne passe lm_campaigns.sender_id ; ici on le déduit de l'expéditeur retenu
  // (celui par défaut = « Par défaut », même affichage)
  const chosenSenderId = sender && !sender.is_default ? sender.id : null;

  if (props.compact) {
    return (
      <div className={'flex flex-col gap-2'} data-test={'contact-sender'}>
        <div className={'flex items-center justify-between gap-2'}>
          <span className={panelLabelClasses}>{t('senderTitle')}</span>

          <Link
            href={senderHref}
            className={panelLinkClasses}
            data-test={'contact-sender-link'}
          >
            {sender ? t('senderEdit') : t('senderFill')}
          </Link>
        </div>

        {senders.length > 1 ? (
          <CampaignSenderSelect
            compact
            campaignId={props.campaignId}
            senders={senderOptions}
            chosenSenderId={chosenSenderId}
          />
        ) : (
          <Link href={senderHref} className={panelSelectorClasses}>
            <span className={'min-w-0 truncate'}>
              {sender
                ? `${sender.first_name} ${sender.last_name} · ${sender.company}`
                : t('senderMissing')}
            </span>
            <ChevronRight className={'text-muted-foreground size-4 shrink-0'} />
          </Link>
        )}
      </div>
    );
  }

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
          senders={senderOptions}
          chosenSenderId={chosenSenderId}
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
