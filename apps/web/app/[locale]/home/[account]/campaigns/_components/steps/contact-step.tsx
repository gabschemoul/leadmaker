/**
 * Rôle : étape Envoi (ex-Contacter) d'une campagne (composant serveur). Un seul écran depuis le 12/11/2026
 * (maquette validée par Gabriel, plus de mode Avancé) : le pilote automatique (combien, réglages, lancer, puis le
 * suivi) et « À vous de jouer » (formulaires à vérifier, sites protégés, cases à compléter, un par un).
 * Données : props de la page campagne (pilote) ; expéditeurs de l'espace et expéditeur de la campagne
 * (sender.loader).
 * Écritures : aucune ici (déléguées à ContactAutopilot, EnvoiTodoProvider, CampaignSenderSelect).
 */

import Link from 'next/link';

import {
  ChevronRight,
  MessageSquareText,
  Search,
  UserRound,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

import pathsConfig from '~/config/paths.config';
import {
  type AutopilotSummary,
  isAutopilotActive,
} from '~/lib/leadmaker/autopilot-query';

import {
  panelLabelClasses,
  panelLinkClasses,
  panelSelectorClasses,
} from '../../../_components/leadmaker/panel-classes';
import {
  loadCampaignSender,
  loadSenders,
} from '../../../sender/_lib/server/sender.loader';
import { CampaignSenderSelect } from '../campaign-sender-select';
import { type AutopilotMessage, ContactAutopilot } from './contact-autopilot';
import { EnvoiTodoProvider } from './envoi-todo';

/**
 * Étape 4, Envoi : combien de prospects contacter, les réglages (quand, qui, quels messages), « Lancer l'envoi » ;
 * Prospectigo prépare et envoie tout seul, à son propre rythme. Ce qui demande une décision (doute, site protégé,
 * case inconnue) attend dans « À vous de jouer ».
 */
export async function ContactStep(props: {
  campaignId: string;
  accountId: string;
  spaceId: string;
  basePath: string;
  prospects: number;
  messagesCount: number;
  hasSender: boolean;
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

  // expéditeur en clair pour la confirmation du lancement du pilote (analyse UX V-01)
  const campaignSender = await loadCampaignSender(
    getSupabaseServerClient(),
    props.campaignId,
  );
  const senderLabel = campaignSender
    ? [
        `${campaignSender.first_name} ${campaignSender.last_name}`,
        campaignSender.company,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const senderRow = (
    <ContactSender
      campaignId={props.campaignId}
      spaceId={props.spaceId}
      basePath={props.basePath}
    />
  );

  return (
    <EnvoiTodoProvider
      campaignId={props.campaignId}
      accountId={props.accountId}
      live={isAutopilotActive(props.autopilot?.status)}
    >
      <div
        className={'flex flex-col gap-4'}
        data-test={'campaign-step-contact'}
      >
        {props.prospects === 0 ? (
          <Hint
            icon={<Search />}
            text={t('noProspects')}
            href={props.discoverHref}
            label={t('goDiscover')}
            testId={'contact-no-prospects'}
          />
        ) : null}

        {props.messagesCount === 0 ? (
          <Hint
            icon={<MessageSquareText />}
            text={t('noMessage')}
            href={props.writeHref}
            label={t('writeMessage')}
            testId={'contact-no-message'}
            warning
          />
        ) : null}

        {!props.hasSender ? (
          <Hint
            icon={<UserRound />}
            text={t('noSender')}
            href={props.writeHref}
            label={t('writeMessage')}
            testId={'contact-no-sender'}
            warning
          />
        ) : null}

        <ContactAutopilot
          campaignId={props.campaignId}
          initialSummary={props.autopilot}
          messages={props.messages}
          perGroup={props.perGroup}
          writeHref={props.writeHref}
          senderSection={senderRow}
          senderLabel={senderLabel}
          billingHref={props.billingHref}
          hasPlan={props.hasPlan}
          // le nombre de prospects contactables est vérifié par le pilote lui-même
          ready={props.messagesCount > 0 && props.hasSender}
        />
      </div>
    </EnvoiTodoProvider>
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
  const tPanel = await getTranslations('campaigns.autopilot.panel');
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

  return (
    <div className={'flex flex-col gap-2'} data-test={'contact-sender'}>
      <div className={'flex items-center justify-between gap-2'}>
        <span className={panelLabelClasses}>{t('senderTitle')}</span>

        <Link
          href={senderHref}
          className={panelLinkClasses}
          data-test={'contact-sender-link'}
        >
          {sender ? tPanel('edit') : t('senderFill')}
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

/**
 * Ce qui manque avant d'envoyer (message, expéditeur, prospects) : une carte calme aux couleurs de l'appli,
 * icône dans une pastille, phrase, bouton à droite (11/11 : l'ancien encart jaune était « hors DA »).
 */
function Hint(props: {
  icon: React.ReactNode;
  text: string;
  href: string;
  label: string;
  testId: string;
  warning?: boolean;
}) {
  return (
    <div
      className={
        'bg-card ring-foreground/10 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ring-1'
      }
      data-test={props.testId}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-4',
          props.warning
            ? 'bg-brand-pale text-brand-hover dark:text-brand'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {props.icon}
      </span>

      <p className={'min-w-0 flex-1 text-sm'}>{props.text}</p>

      <Button
        size={'sm'}
        variant={'outline'}
        nativeButton={false}
        render={<Link href={props.href} />}
      >
        {props.label}
      </Button>
    </div>
  );
}
