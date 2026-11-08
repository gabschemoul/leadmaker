/**
 * Rôle : page d'une campagne, parcours en quatre étapes (Cibler, Trouver, Rédiger, Contacter) via `?etape=`.
 * Données : campaigns.loader, forms.loader, sender.loader, leadmaker.loader (client Supabase de l'utilisateur).
 * Écritures : aucune ici (actions serveur dans les composants d'étape).
 */

import { Suspense } from 'react';

import { notFound } from 'next/navigation';

import { getLocale, getTranslations } from 'next-intl/server';
import * as z from 'zod';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import {
  CardSkeleton,
  Delayed,
  PageHeaderSkeleton,
} from '~/components/skeletons/page-skeletons';
import pathsConfig from '~/config/paths.config';
import { type AttemptGroup, isAttemptGroup } from '~/lib/leadmaker/attempts';
import { fetchAutopilotSummary } from '~/lib/leadmaker/autopilot-query';
import { buildProspectsHref } from '~/lib/leadmaker/prospects-query';
import { parseTemplates, usableMessages } from '~/lib/leadmaker/templates';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadSpaces,
} from '../../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import {
  loadAttempts,
  loadCampaignAttemptCounts,
} from '../../forms/_lib/server/forms.loader';
import {
  loadCampaignSender,
  loadSenders,
} from '../../sender/_lib/server/sender.loader';
import { CampaignHeaderActions } from '../_components/campaign-header-actions';
import { CampaignLocalDiscovery } from '../_components/campaign-local-discovery';
import { CampaignStepsRail } from '../_components/steps/campaign-steps-rail';
import {
  type ContactMode,
  ContactStep,
} from '../_components/steps/contact-step';
import { DiscoverStep } from '../_components/steps/discover-step';
import { TargetStep } from '../_components/steps/target-step';
import { WriteStep } from '../_components/steps/write-step';
import { fetchCampaignLive } from '../_lib/campaign-live';
import {
  loadAutoValidationAllowed,
  loadCampaign,
  loadCampaignForEdit,
  loadLocalDiscoveryState,
  loadPreviewProspects,
} from '../_lib/server/campaigns.loader';
import { isPowerUser } from '../_lib/server/power-user';
import {
  type CampaignStep,
  type CampaignStepFacts,
  defaultStep,
  isCampaignStep,
} from '../_lib/steps';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface CampaignPageProps {
  params: Promise<{ account: string; id: string }>;
  searchParams: SearchParams;
}

export const generateMetadata = async () => {
  const t = await getTranslations('campaigns');

  return {
    title: t('detail.pageTitle'),
  };
};

/**
 * La page d'une campagne : son parcours en quatre étapes (Cibler, Trouver,
 * Rédiger, Contacter), chaque étape étant un onglet `?etape=`.
 * L'en-tête porte le nom de la campagne : il attend donc les mêmes données
 * que le contenu et partage sa frontière.
 */
function CampaignPage({ params, searchParams }: CampaignPageProps) {
  return (
    <PageBody>
      <Suspense
        fallback={
          <>
            <PageHeaderSkeleton />

            <Delayed className={'flex flex-col gap-6'}>
              <CardSkeleton rows={1} />
              <CardSkeleton rows={6} />
            </Delayed>
          </>
        }
      >
        <CampaignContent params={params} searchParams={searchParams} />
      </Suspense>
    </PageBody>
  );
}

export default CampaignPage;

async function CampaignContent({ params, searchParams }: CampaignPageProps) {
  const [{ account: slug, id }, rawSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);

  if (!z.string().uuid().safeParse(id).success) {
    notFound();
  }

  // vérifie l'appartenance à l'organisation (et redirige sinon)
  const { account } = await loadTeamWorkspace(slug);
  const client = getSupabaseServerClient();

  const [campaign, countries, spaces] = await Promise.all([
    loadCampaign(client, id),
    loadCountryOptions(client),
    loadSpaces(client, account.id),
  ]);

  if (!campaign) {
    notFound();
  }

  const [live, counts, sender, autopilot, localDiscovery] = await Promise.all([
    fetchCampaignLive(client, id),
    loadCampaignAttemptCounts(client, id),
    loadCampaignSender(client, campaign.id),
    fetchAutopilotSummary(client, id),
    loadLocalDiscoveryState(client, id),
  ]);

  const templates = parseTemplates(campaign.templates);
  const messages = usableMessages(templates);
  const messagesCount = messages.length;

  const facts: CampaignStepFacts = {
    status: live.status,
    pausedReason: live.pausedReason,
    prospects: live.progress.prospects,
    messagesCount,
    hasSender: sender !== null,
    attempts: counts,
    autopilot: autopilot?.status
      ? {
          status: autopilot.status,
          sent: autopilot.sent,
          target: autopilot.target ?? 0,
        }
      : null,
  };

  const step: CampaignStep = isCampaignStep(rawSearchParams.etape)
    ? rawSearchParams.etape
    : defaultStep(facts);

  const countryLabel =
    countries.find((country) => country.code === campaign.country_code)
      ?.label ?? campaign.country_code;

  // le dossier client n'est mentionné que si l'organisation en a plusieurs
  const folderName =
    spaces.length > 1
      ? (spaces.find((space) => space.id === campaign.space_id)?.label ?? null)
      : null;

  const campaignsPath = pathsConfig.app.accountCampaigns.replace(
    '[account]',
    slug,
  );
  const basePath = `${campaignsPath}/${id}`;
  const stepHref = (target: CampaignStep) => `${basePath}?etape=${target}`;
  const formsHref = `${pathsConfig.app.accountForms.replace('[account]', slug)}?space=${campaign.space_id}`;
  const senderHref = `${pathsConfig.app.accountSender.replace('[account]', slug)}?space=${campaign.space_id}${sender ? `&sender=${sender.id}` : ''}`;

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={campaign.name}
        description={<AppBreadcrumbs values={{ [id]: campaign.name }} />}
      >
        <CampaignHeaderActions
          campaignId={id}
          campaignName={campaign.name}
          accountSlug={slug}
          archived={campaign.status === 'archived'}
        />
      </TeamAccountLayoutPageHeader>

      <div className={'-mt-2 flex flex-col gap-5 pb-32'}>
        {campaign.status === 'archived' ? (
          <Alert data-test={'campaign-archived-banner'}>
            <AlertTitle>
              <Trans i18nKey={'campaigns.archive.bannerTitle'} />
            </AlertTitle>
            <AlertDescription>
              <Trans i18nKey={'campaigns.archive.bannerDescription'} />
            </AlertDescription>
          </Alert>
        ) : null}

        {folderName ? (
          <p
            className={'text-muted-foreground text-sm'}
            data-test={'campaign-folder'}
          >
            <Trans i18nKey={'campaigns.detail.folder'} />{' '}
            <span className={'text-foreground'}>{folderName}</span>
          </p>
        ) : null}

        <CampaignStepsRail
          basePath={basePath}
          active={step}
          facts={facts}
          countryLabel={countryLabel}
          zones={live.progress.zones}
          categories={live.progress.categories}
        />

        {localDiscovery ? (
          <CampaignLocalDiscovery
            campaignId={id}
            allowed={localDiscovery.allowed}
            enabled={localDiscovery.enabled}
            minutesAgo={localDiscovery.minutesAgo}
          />
        ) : null}

        {step === 'cibler' ? (
          <TargetStepContent
            campaignId={id}
            countryLabel={countryLabel}
            editHref={`${basePath}/edit`}
            nextHref={stepHref('trouver')}
          />
        ) : null}

        {step === 'trouver' ? (
          <DiscoverStep
            campaignId={id}
            accountId={account.id}
            campaignsPath={campaignsPath}
            allProspectsHref={buildProspectsHref(
              pathsConfig.app.accountProspects.replace('[account]', slug),
              {
                space: spaces.length > 1 ? campaign.space_id : undefined,
                filters: { campaign: id, status: 'all' },
              },
            )}
            canDelete={account.permissions.includes('settings.manage')}
            billingPath={pathsConfig.app.accountBilling.replace(
              '[account]',
              slug,
            )}
            formsHref={formsHref}
            writeHref={stepHref('rediger')}
            readyToWrite={messagesCount > 0 && sender !== null}
            initialData={live}
          />
        ) : null}

        {step === 'rediger' ? (
          <WriteStepContent
            accountId={account.id}
            campaign={campaign}
            templates={templates}
            sender={sender}
            senderHref={senderHref}
          />
        ) : null}

        {step === 'contacter' ? (
          <ContactStepContent
            campaign={campaign}
            accountId={account.id}
            basePath={basePath}
            facts={facts}
            group={
              isAttemptGroup(rawSearchParams.statut)
                ? rawSearchParams.statut
                : 'ready'
            }
            // mode Avancé : demandé dans l'adresse, ou lien direct vers un onglet de formulaires
            mode={
              rawSearchParams.mode === 'avance' ||
              isAttemptGroup(rawSearchParams.statut)
                ? 'advanced'
                : 'auto'
            }
            autopilot={autopilot}
            messages={messages.map((message) => ({
              name: message.name,
              preview: message.body.replace(/\s+/g, ' ').trim().slice(0, 120),
            }))}
            billingHref={pathsConfig.app.accountBilling.replace(
              '[account]',
              slug,
            )}
            writeHref={stepHref('rediger')}
            discoverHref={stepHref('trouver')}
          />
        ) : null}
      </div>
    </>
  );
}

type Campaign = NonNullable<Awaited<ReturnType<typeof loadCampaign>>>;

async function TargetStepContent(props: {
  campaignId: string;
  countryLabel: string;
  editHref: string;
  nextHref: string;
}) {
  const client = getSupabaseServerClient();
  const locale = await getLocale();
  const campaign = await loadCampaignForEdit(client, props.campaignId, locale);

  if (!campaign) {
    notFound();
  }

  return (
    <TargetStep
      campaign={campaign}
      countryLabel={props.countryLabel}
      editHref={props.editHref}
      nextHref={props.nextHref}
    />
  );
}

async function WriteStepContent(props: {
  accountId: string;
  campaign: Campaign;
  templates: ReturnType<typeof parseTemplates>;
  sender: Awaited<ReturnType<typeof loadCampaignSender>>;
  senderHref: string;
}) {
  const client = getSupabaseServerClient();
  const user = await requireUserInServerComponent();

  const [prospects, autoValidationAllowed, companyOptional, senders] =
    await Promise.all([
      loadPreviewProspects(client, props.campaign.space_id),
      loadAutoValidationAllowed(client, props.accountId),
      isPowerUser(user.id),
      loadSenders(client, props.campaign.space_id),
    ]);

  return (
    <WriteStep
      accountId={props.accountId}
      campaignId={props.campaign.id}
      templates={props.templates}
      sender={props.sender}
      senderHref={props.senderHref}
      prospects={prospects}
      sending={{
        dailyLimit: props.campaign.daily_limit,
        autoValidation: props.campaign.auto_validation,
        autoValidationAllowed,
      }}
      companyOptional={companyOptional}
      senders={senders.map(
        ({ id, first_name, last_name, company, is_default }) => ({
          id,
          first_name,
          last_name,
          company,
          is_default,
        }),
      )}
      chosenSenderId={props.campaign.sender_id}
    />
  );
}

async function ContactStepContent(props: {
  campaign: Campaign;
  accountId: string;
  basePath: string;
  facts: CampaignStepFacts;
  group: AttemptGroup;
  mode: ContactMode;
  autopilot: Awaited<ReturnType<typeof fetchAutopilotSummary>>;
  messages: Array<{ name: string; preview: string }>;
  billingHref: string;
  writeHref: string;
  discoverHref: string;
}) {
  const client = getSupabaseServerClient();

  // la liste des formulaires n'est chargée qu'en mode Avancé
  const rows =
    props.mode === 'advanced'
      ? await loadAttempts(client, {
          spaceId: props.campaign.space_id,
          campaignId: props.campaign.id,
          group: props.group,
        })
      : [];

  return (
    <ContactStep
      mode={props.mode}
      autopilot={props.autopilot}
      messages={props.messages}
      billingHref={props.billingHref}
      campaignId={props.campaign.id}
      accountId={props.accountId}
      spaceId={props.campaign.space_id}
      basePath={props.basePath}
      prospects={props.facts.prospects}
      messagesCount={props.facts.messagesCount}
      hasSender={props.facts.hasSender}
      dailyLimit={props.campaign.daily_limit}
      autoValidation={props.campaign.auto_validation}
      counts={props.facts.attempts}
      group={props.group}
      rows={rows}
      writeHref={props.writeHref}
      discoverHref={props.discoverHref}
    />
  );
}
