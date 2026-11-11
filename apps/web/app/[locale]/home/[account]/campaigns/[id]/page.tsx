/**
 * Rôle : page d'une campagne, parcours en quatre étapes (Cible, Prospects, Message, Envoi ; dans le code : cibler,
 * trouver, rediger, contacter) via `?etape=` (Résultats retiré le 12/11/2026, à remettre plus tard). Campagne triée (cible en mots) : l'étape « trouver »
 * est l'écran « Vos entreprises » ; sinon l'ancien écran de recherche.
 * Données : campaigns.loader, forms.loader, sender.loader, leadmaker.loader (client Supabase de
 * l'utilisateur).
 * Écritures : aucune ici (actions serveur dans les composants d'étape).
 */

import { Suspense } from 'react';

import { notFound } from 'next/navigation';
import { connection } from 'next/server';

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
import {
  fetchAutopilotFacts,
  fetchAutopilotSummary,
} from '~/lib/leadmaker/autopilot-query';
import { buildProspectsHref } from '~/lib/leadmaker/prospects-query';
import { parseTemplates, usableMessages } from '~/lib/leadmaker/templates';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import {
  loadCountryOptions,
  loadHasPlan,
  loadSpaces,
} from '../../_lib/server/leadmaker.loader';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { loadCampaignAttemptCounts } from '../../forms/_lib/server/forms.loader';
import {
  loadCampaignSender,
  loadSenders,
} from '../../sender/_lib/server/sender.loader';
import { CampaignHeaderActions } from '../_components/campaign-header-actions';
import { CampaignLocalDiscovery } from '../_components/campaign-local-discovery';
import {
  CampaignStepContent,
  CampaignStepNavigation,
} from '../_components/steps/campaign-step-navigation';
import {
  CampaignStepsRail,
  CampaignStepsRailLoading,
} from '../_components/steps/campaign-steps-rail';
import { CompaniesStep } from '../_components/steps/companies-step';
import { ContactStep } from '../_components/steps/contact-step';
import { DiscoverStep } from '../_components/steps/discover-step';
import { TargetStep } from '../_components/steps/target-step';
import { WriteStep } from '../_components/steps/write-step';
import { fetchCampaignLive } from '../_lib/campaign-live';
import { isLaunchError } from '../_lib/schema/campaign.schema';
import {
  loadAutoValidationAllowed,
  loadCampaign,
  loadCampaignForEdit,
  loadKeptPreviewByGroup,
  loadKeptPreviewProspects,
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
            <PageHeaderSkeleton withActions />

            {/* noms des étapes tout de suite ; le contenu de l'étape attend la campagne */}
            <div className={'flex flex-col gap-6'}>
              <CampaignStepsRailLoading />

              <Delayed className={'flex flex-col gap-6'}>
                <CardSkeleton rows={2} />
                <CardSkeleton rows={6} />
              </Delayed>
            </div>
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

  // les requêtes partent toutes en même temps, avant le contrôle de session qui lisait l'heure : on marque la
  // page « à la demande » d'abord (sinon erreur « Date.now() while prerendering » dans les journaux)
  await connection();

  const client = getSupabaseServerClient();

  // Une seule vague (10/11/2026, avant trois vagues qui s'attendaient : ~1,8 s avant l'étape). Les données sont
  // protégées par la RLS ; loadTeamWorkspace vérifie en même temps l'appartenance à l'organisation (et
  // redirige sinon).
  const workspace = loadTeamWorkspace(slug);

  const [
    { account },
    campaign,
    countries,
    spaces,
    live,
    counts,
    sender,
    autopilot,
    localDiscovery,
  ] = await Promise.all([
    workspace,
    loadCampaign(client, id),
    loadCountryOptions(client),
    workspace.then((ws) => loadSpaces(client, ws.account.id)),
    fetchCampaignLive(client, id),
    loadCampaignAttemptCounts(client, id),
    loadCampaignSender(client, id),
    fetchAutopilotFacts(client, id),
    loadLocalDiscoveryState(client, id),
  ]);

  if (!campaign) {
    notFound();
  }

  const templates = parseTemplates(campaign.templates);
  // « Un message par groupe » (encart des groupes) : un jeu de versions par groupe, plus « Pour les autres »
  const groups = live.groups.choice === 'per_group' ? live.groups.list : [];
  const perGroup = groups.length > 0;
  const groupLabel = new Map(groups.map((group) => [group.key, group.label]));
  const messages = usableMessages(templates, perGroup);
  const messagesCount = messages.length;

  const facts: CampaignStepFacts = {
    status: live.status,
    pausedReason: live.pausedReason,
    prospects: live.progress.prospects,
    kept: live.sort ? live.sort.kept : null,
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

        {isLaunchError(rawSearchParams.erreur) ? (
          <Alert variant={'destructive'} data-test={'campaign-launch-error'}>
            <AlertDescription>
              <Trans
                i18nKey={`campaigns.launchErrors.${rawSearchParams.erreur}`}
              />
            </AlertDescription>
          </Alert>
        ) : null}

        {folderName ? (
          <p
            className={'text-muted-foreground text-sm'}
            data-test={'campaign-folder'}
          >
            <Trans i18nKey={'campaigns.detail.folder'} />{' '}
            <span>{folderName}</span>
          </p>
        ) : null}

        <CampaignStepNavigation active={step}>
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

          {/* étape demandée : silhouette pendant son chargement (campaign-step-navigation.tsx) ; son contenu
              arrive à part, sans retarder l'en-tête ni le rail */}
          <CampaignStepContent>
            <Suspense
              fallback={
                <div className={'flex flex-col gap-4'}>
                  <CardSkeleton rows={2} />
                  <CardSkeleton rows={6} />
                </div>
              }
            >
              {step === 'cibler' ? (
                <TargetStepContent
                  campaignId={id}
                  countryLabel={countryLabel}
                  editHref={`${basePath}/edit`}
                  nextHref={stepHref('trouver')}
                  launched={live.progress.zones > 0}
                />
              ) : null}

              {step === 'trouver' && live.sort ? (
                <CompaniesStep
                  campaignId={id}
                  editHref={`${basePath}/edit`}
                  writeHref={stepHref('rediger')}
                  billingPath={pathsConfig.app.accountBilling.replace(
                    '[account]',
                    slug,
                  )}
                  campaignsPath={campaignsPath}
                  initialData={live}
                />
              ) : null}

              {step === 'trouver' && !live.sort ? (
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
                  targetHref={stepHref('cibler')}
                  readyToWrite={messagesCount > 0 && sender !== null}
                  initialData={live}
                />
              ) : null}

              {step === 'rediger' ? (
                <WriteStepContent
                  accountId={account.id}
                  campaign={campaign}
                  templates={templates}
                  groups={perGroup ? groups : null}
                  sender={sender}
                  senderHref={senderHref}
                  nextHref={stepHref('contacter')}
                />
              ) : null}

              {step === 'contacter' ? (
                <ContactStepContent
                  campaign={campaign}
                  accountId={account.id}
                  basePath={basePath}
                  facts={facts}
                  messages={groupOrdered(messages, groups).map((message) => ({
                    name: message.name,
                    preview: message.body
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 120),
                    // « Un message par groupe » : rangés sous le nom de leur groupe (null = « Pour les autres »)
                    group:
                      perGroup && message.group
                        ? (groupLabel.get(message.group) ?? null)
                        : null,
                  }))}
                  perGroup={perGroup}
                  billingHref={pathsConfig.app.accountBilling.replace(
                    '[account]',
                    slug,
                  )}
                  writeHref={stepHref('rediger')}
                  discoverHref={stepHref('trouver')}
                />
              ) : null}
            </Suspense>
          </CampaignStepContent>
        </CampaignStepNavigation>
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
  launched: boolean;
}) {
  const client = getSupabaseServerClient();
  const locale = await getLocale();
  const campaign = await loadCampaignForEdit(
    client,
    props.campaignId,
    locale,
    props.launched,
  );

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

type CampaignGroup = { key: string; label: string; kept: number };

async function WriteStepContent(props: {
  accountId: string;
  campaign: Campaign;
  templates: ReturnType<typeof parseTemplates>;
  /** « Un message par groupe » : les groupes de la campagne ; null sinon */
  groups: CampaignGroup[] | null;
  sender: Awaited<ReturnType<typeof loadCampaignSender>>;
  senderHref: string;
  nextHref: string;
}) {
  const client = getSupabaseServerClient();
  // campagne triée (cible en mots) : l'aperçu se fait sur ses entreprises gardées
  const sorted = Boolean(props.campaign.sort_target?.trim());
  const groupKeys = (props.groups ?? []).map((group) => group.key);

  // tout en même temps (10/11/2026 : l'utilisateur était vérifié avant le reste)
  const [
    prospects,
    keptProspects,
    autoValidationAllowed,
    companyOptional,
    senders,
    previewByGroup,
  ] = await Promise.all([
    loadPreviewProspects(client, props.campaign.space_id),
    sorted
      ? loadKeptPreviewProspects(
          client,
          props.campaign.id,
          props.campaign.sort_version,
        )
      : Promise.resolve([]),
    loadAutoValidationAllowed(client, props.accountId),
    requireUserInServerComponent().then((user) => isPowerUser(user.id)),
    loadSenders(client, props.campaign.space_id),
    // aperçu de chaque onglet de groupe sur ses propres entreprises gardées (une seule requête)
    groupKeys.length > 0
      ? loadKeptPreviewByGroup(
          client,
          props.campaign.id,
          props.campaign.sort_version,
          groupKeys,
        )
      : Promise.resolve({}),
  ]);

  return (
    <WriteStep
      accountId={props.accountId}
      campaignId={props.campaign.id}
      templates={props.templates}
      sender={props.sender}
      senderHref={props.senderHref}
      nextHref={props.nextHref}
      sorted={sorted}
      // entreprises gardées d'abord ; sinon (aucune encore) les derniers prospects du dossier, comme avant
      prospects={keptProspects.length > 0 ? keptProspects : prospects}
      groups={props.groups}
      previewByGroup={previewByGroup}
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
  messages: Array<{ name: string; preview: string; group: string | null }>;
  perGroup: boolean;
  billingHref: string;
  writeHref: string;
  discoverHref: string;
}) {
  const client = getSupabaseServerClient();

  // le résumé complet du pilote n'est chargé qu'ici
  const [hasPlan, autopilot] = await Promise.all([
    loadHasPlan(client, props.accountId),
    fetchAutopilotSummary(client, props.campaign.id),
  ]);

  return (
    <ContactStep
      autopilot={autopilot}
      messages={props.messages}
      perGroup={props.perGroup}
      billingHref={props.billingHref}
      hasPlan={hasPlan}
      campaignId={props.campaign.id}
      accountId={props.accountId}
      spaceId={props.campaign.space_id}
      basePath={props.basePath}
      prospects={props.facts.prospects}
      messagesCount={props.facts.messagesCount}
      hasSender={props.facts.hasSender}
      writeHref={props.writeHref}
      discoverHref={props.discoverHref}
    />
  );
}

/**
 * « Un message par groupe » : messages rangés dans l'ordre des groupes, ceux « Pour les autres » à la fin (ordre
 * d'origine conservé à l'intérieur). Sans groupes, liste inchangée.
 */
function groupOrdered<T extends { group: string | null }>(
  messages: T[],
  groups: Array<{ key: string }>,
) {
  const rank = (message: T) => {
    const index = groups.findIndex((group) => group.key === message.group);

    return index === -1 ? groups.length : index;
  };

  return [...messages].sort((a, b) => rank(a) - rank(b));
}
