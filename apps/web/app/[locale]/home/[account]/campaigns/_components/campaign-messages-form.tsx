'use client';

/**
 * Rôle : étape « Votre message » (CDC-PARCOURS-TRI-ANNUAIRE §6) — versions A à D du message (envoyées à tour de
 * rôle), « Proposer avec l'IA » (campagne triée), boutons « Insérer : Entreprise / Ville / Activité », aperçu du
 * formulaire rempli sur une vraie entreprise (« Autre » pour la suivante), « Suivant : l'envoi ».
 * « Un message par groupe » (choix de l'encart des groupes, 10/11) : un onglet par groupe plus « Pour les autres »,
 * chacun avec ses versions A à D ; un message rangé dans un groupe porte sa clé (`group`). Sans ce choix, seuls les
 * messages sans groupe sont affichés ; ceux d'un groupe sont renvoyés tels quels à l'enregistrement.
 * Données : modèles, expéditeur et entreprises d'aperçu passés par la page (gardées de la campagne triée, par
 * groupe si besoin, sinon derniers prospects du dossier) ; variables dans ~/lib/leadmaker/templates.
 * Écritures : saveCampaignTemplatesAction (lm_campaigns.templates, daily_limit, auto_validation) ;
 * proposeMessageAction (compteur du plafond quotidien seulement : la proposition n'est enregistrée qu'avec
 * « Enregistrer les messages »).
 */
import {
  type BaseSyntheticEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Plus,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm, useWatch } from 'react-hook-form';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Textarea } from '@kit/ui/textarea';
import { Trans } from '@kit/ui/trans';

import { InfoTip } from '~/components/info-tip';
import {
  BODY_MAX,
  type CampaignTemplates,
  MAX_VERSIONS_PER_GROUP,
  type MessageTemplate,
  SHORT_BODY_MAX,
  SUBJECT_MAX,
  TEMPLATE_VARIABLES,
  type TemplateContext,
  mentionsCompany,
  renderTemplate,
  unknownVariables,
} from '~/lib/leadmaker/templates';

import { CampaignTemplatesFormSchema } from '../_lib/schema/templates.schema';
import { saveCampaignTemplatesAction } from '../_lib/server/campaign-outreach-actions';
import { proposeMessageAction } from '../_lib/server/message-ai-actions';

type PreviewProspect = TemplateContext['prospect'] & { id: string };

/** zone de texte d'une version : son objet, son texte ou sa version courte */
type TextField = 'subject' | 'body' | 'short';

type MessageText = Record<TextField, string>;

/** variables mises en avant (« Insérer : Entreprise / Ville / Activité ») ; les autres sont dans « Autres » */
const MAIN_VARIABLES = ['company', 'city', 'category'] as const;

const AI_ERRORS = ['quotaReached', 'unavailable', 'failed'] as const;

/** lettre de la version (A, B, C, D) */
const versionLetter = (index: number) => String.fromCharCode(65 + index);

/** onglet de messages : un groupe de la campagne, ou « Pour les autres » / message unique (key null) */
interface MessageTab {
  key: string | null;
  label: string;
  /** entreprises gardées du groupe (null pour « Pour les autres ») */
  kept: number | null;
}

/** case du formulaire : onglet × version (4 cases par onglet, les vides ne sont pas enregistrées) */
const slotIndex = (tab: number, version: number) =>
  tab * MAX_VERSIONS_PER_GROUP + version;

export function CampaignMessagesForm(props: {
  accountId: string;
  campaignId: string;
  templates: CampaignTemplates;
  sender: TemplateContext['sender'];
  senderHref: string;
  /** carte de l'expéditeur, affichée en haut du panneau de droite */
  senderCard: ReactNode;
  /** étape suivante (« Envoi ») */
  nextHref: string;
  /** campagne triée (cible en mots) : « Proposer avec l'IA » */
  sorted: boolean;
  prospects: PreviewProspect[];
  /**
   * « Un message par groupe » : les groupes de la campagne (un onglet chacun, puis « Pour les autres ») ; null sinon
   * (un seul jeu de versions, messages sans groupe)
   */
  groups: Array<{ key: string; label: string; kept: number }> | null;
  /** entreprises gardées de chaque groupe pour l'aperçu (sinon `prospects`) */
  previewByGroup?: Record<string, PreviewProspect[]>;
  sending: {
    dailyLimit: number;
    autoValidation: boolean;
    /** le forfait de l'organisation inclut la validation automatique */
    autoValidationAllowed: boolean;
  };
  /** dispensé de mentionner la société (utilisateurs sans limite) */
  companyOptional: boolean;
}) {
  const t = useTranslations('outreach.messages');
  const tm = useTranslations('campaigns.messages');
  const router = useRouter();

  // « Suivant : l'envoi » enregistre d'abord les changements, puis passe à l'étape suivante
  // (la référence pour la logique des rappels, l'état pour savoir quel bouton tourne)
  const goNextAfterSave = useRef(false);
  const [goingNext, setGoingNext] = useState(false);

  const setNextIntent = (value: boolean) => {
    goNextAfterSave.current = value;
    setGoingNext(value);
  };

  const perGroup = props.groups !== null;

  const othersLabel = tm('othersTab');
  const tabs: MessageTab[] = props.groups
    ? [
        ...props.groups.map((group) => ({ ...group })),
        { key: null, label: othersLabel, kept: null },
      ]
    : [{ key: null, label: othersLabel, kept: null }];

  // messages d'aucun onglet (réservés à un groupe sans « Un message par groupe », ou à un groupe qui n'existe
  // plus) : ni affichés ni modifiés, renvoyés tels quels à l'enregistrement
  // garde-fou : les versions au-delà de MAX_VERSIONS_PER_GROUP dans un onglet sont aussi gardées telles quelles
  // (11/11/2026 : une campagne à 7 messages perdait les 3 derniers en enregistrant)
  const [hidden] = useState(() => [
    ...props.templates.messages.filter(
      (message) => !tabs.some((tab) => tab.key === message.group),
    ),
    ...tabs.flatMap((tab) =>
      props.templates.messages
        .filter((message) => message.group === tab.key)
        .slice(MAX_VERSIONS_PER_GROUP),
    ),
  ]);

  const tabMessages = (tab: MessageTab) =>
    props.templates.messages.filter((message) => message.group === tab.key);

  // nom par défaut d'une version : « Message 1 » comme avant, ou « Groupe · Version A » (unique dans la campagne)
  const defaultName = (tab: MessageTab, version: number) =>
    perGroup
      ? tm('defaultName', { group: tab.label, letter: versionLetter(version) })
      : `Message ${version + 1}`;

  const form = useForm({
    resolver: zodResolver(CampaignTemplatesFormSchema),
    defaultValues: {
      messages: tabs.flatMap((tab) => {
        const own: Array<MessageTemplate | undefined> = tabMessages(tab);

        return Array.from({ length: MAX_VERSIONS_PER_GROUP }, (_, version) => ({
          name: own[version]?.name ?? defaultName(tab, version),
          subject: own[version]?.subject ?? '',
          body: own[version]?.body ?? '',
          short: own[version]?.short ?? '',
          group: tab.key,
        }));
      }),
      dailyLimit: props.sending.dailyLimit,
      autoValidation: props.sending.autoValidation,
    },
  });

  const save = useAction(saveCampaignTemplatesAction, {
    onSuccess: ({ data }) => {
      toast.success(t('saved', { count: data?.count ?? 0 }));
      // les valeurs enregistrées deviennent la référence (plus de changement en attente)
      form.reset(form.getValues());

      if (goNextAfterSave.current) {
        setNextIntent(false);
        // l'action d'enregistrement est partagée et ne redirige pas : on navigue ici, une fois enregistré
        router.push(props.nextHref);
      }
    },
    onError: ({ error }) => {
      setNextIntent(false);
      toast.error(
        t(error.serverError?.replace('outreach.messages.', '') ?? 'saveFailed'),
      );
    },
  });

  const values = useWatch({ control: form.control });

  // par onglet, versions affichées : au moins A et B (A seule par groupe), plus celles déjà remplies ; « + » en
  // ajoute une (jusqu'à 4). `tab` : onglet ouvert ; `versions` : version ouverte de chaque onglet
  const [view, setView] = useState(() => ({
    tab: 0,
    versions: tabs.map(() => 0),
    counts: tabs.map((tab) => {
      const lastFilled = tabMessages(tab).reduce(
        (last, message, index) => (message.body.trim() ? index + 1 : last),
        0,
      );

      return Math.min(
        MAX_VERSIONS_PER_GROUP,
        Math.max(perGroup ? 1 : 2, lastFilled),
      );
    }),
  }));
  const [previewIndex, setPreviewIndex] = useState(0);

  const activeTab = tabs[view.tab] ?? tabs[0]!;
  const versionCount = view.counts[view.tab] ?? 1;
  const activeVersion = view.versions[view.tab] ?? 0;
  const active = slotIndex(view.tab, activeVersion);

  const setActiveVersion = (version: number) =>
    setView((current) => ({
      ...current,
      versions: current.versions.map((value, index) =>
        index === current.tab ? version : value,
      ),
    }));

  // ouvre l'onglet et la version d'une case (par ex. la première en erreur)
  const showSlot = (slot: number) => {
    const tab = Math.floor(slot / MAX_VERSIONS_PER_GROUP);
    const version = slot % MAX_VERSIONS_PER_GROUP;

    setView((current) => ({
      tab,
      versions: current.versions.map((value, index) =>
        index === tab ? version : value,
      ),
      counts: current.counts.map((value, index) =>
        index === tab ? Math.max(value, version + 1) : value,
      ),
    }));
  };

  // dernière proposition de l'IA : de quoi revenir en arrière (« Annuler ») tant qu'elle n'a pas été modifiée
  const [proposal, setProposal] = useState<{
    index: number;
    previous: MessageText;
    proposed: MessageText;
    remaining: number;
  } | null>(null);
  const proposingIndex = useRef(0);

  const fields = useRef<
    Partial<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>
  >({});
  // zone de texte où vont les variables : la dernière où l'on a cliqué (par version)
  const activeField = useRef<Partial<Record<number, TextField>>>({});

  const readText = (index: number): MessageText => ({
    subject: form.getValues(`messages.${index}.subject`) ?? '',
    body: form.getValues(`messages.${index}.body`) ?? '',
    short: form.getValues(`messages.${index}.short`) ?? '',
  });

  const writeText = (index: number, text: MessageText) => {
    for (const key of ['subject', 'body', 'short'] as const) {
      form.setValue(`messages.${index}.${key}`, text[key], {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };

  const propose = useAction(proposeMessageAction, {
    onSuccess: ({ data }) => {
      if (!data) return;

      const index = proposingIndex.current;
      const proposed = {
        subject: data.subject,
        body: data.body,
        short: data.short,
      };

      setProposal({
        index,
        previous: readText(index),
        proposed,
        remaining: data.remaining,
      });
      writeText(index, proposed);
    },
    onError: ({ error }) => {
      const code = error.serverError?.replace('campaigns.messages.ai.', '');
      const known = AI_ERRORS.find((item) => item === code) ?? 'failed';

      toast.error(tm(`ai.${known}`));
    },
  });

  // Message tapé gardé quand on quitte l'étape sans enregistrer (analyse UX M-02, 11/11/2026 : un clic sur une
  // autre étape ou sur « Modifier l'expéditeur » le perdait). useEffect justifié : enregistrer au départ de l'étape
  // (nettoyage), et prévenir le navigateur si l'onglet se ferme avec un message non enregistré.
  const leaveSave = useRef<() => void>(() => undefined);

  useEffect(() => {
    leaveSave.current = () => {
      if (!form.formState.isDirty || save.isPending) {
        return;
      }

      const data = form.getValues();

      if (!CampaignTemplatesFormSchema.safeParse(data).success) {
        return;
      }

      const filled = data.messages.filter(
        (message) => message.body.trim() !== '',
      );
      const hiddenNames = new Set(
        hidden.map((message) => message.name.trim().toLowerCase()),
      );

      if (
        filled.some((message) =>
          hiddenNames.has(message.name.trim().toLowerCase()),
        )
      ) {
        return;
      }

      void saveCampaignTemplatesAction({
        ...data,
        messages: [...filled, ...hidden],
        accountId: props.accountId,
        campaignId: props.campaignId,
      }).then((result) => {
        if (result?.data) {
          toast.success(t('saved', { count: result.data.count ?? 0 }));
        }
      });
    };
  });

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (form.formState.isDirty) {
        event.preventDefault();
      }
    };

    window.addEventListener('beforeunload', warn);

    return () => {
      window.removeEventListener('beforeunload', warn);
      leaveSave.current();
    };
  }, [form]);

  const saving = save.isPending || form.formState.isSubmitting;
  // lu pendant le rendu pour que react-hook-form suive l'état « modifié » (utilisé par « Suivant »)
  const { isDirty } = form.formState;
  const company = props.sender?.company ?? null;

  const submit = (event?: BaseSyntheticEvent) =>
    form.handleSubmit(
      (data) => {
        const filled = data.messages.filter(
          (message) => message.body.trim() !== '',
        );

        // les noms doivent aussi rester différents de ceux des messages non affichés
        const hiddenNames = new Set(
          hidden.map((message) => message.name.trim().toLowerCase()),
        );
        const taken = data.messages.findIndex(
          (message) =>
            message.body.trim() !== '' &&
            hiddenNames.has(message.name.trim().toLowerCase()),
        );

        if (taken >= 0) {
          form.setError(`messages.${taken}.name`, {
            message: 'campaigns.messages.nameTaken',
          });
          showSlot(taken);
          setNextIntent(false);

          return;
        }

        save.execute({
          ...data,
          // cases vides retirées ; messages non affichés renvoyés tels quels
          messages: [...filled, ...hidden],
          accountId: props.accountId,
          campaignId: props.campaignId,
        });
      },
      (errors) => {
        setNextIntent(false);

        // l'erreur peut être dans un autre onglet ou une autre version : on l'ouvre
        const list = errors.messages;
        const slot = Array.isArray(list) ? list.findIndex(Boolean) : -1;

        if (slot >= 0) {
          showSlot(slot);
        }
      },
    )(event);

  /** Insère une variable à l'endroit du curseur de la zone active (objet, texte ou version courte). */
  const insertVariable = (index: number, token: string) => {
    const name =
      `messages.${index}.${activeField.current[index] ?? 'body'}` as const;
    const current = form.getValues(name) ?? '';
    const element = fields.current[name];
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}{${token}}${current.slice(end)}`;

    form.setValue(name, next, { shouldDirty: true, shouldValidate: true });

    requestAnimationFrame(() => {
      element?.focus();
      const cursor = start + token.length + 2;
      element?.setSelectionRange(cursor, cursor);
    });
  };

  const addVersion = () => {
    if (versionCount >= MAX_VERSIONS_PER_GROUP) return;

    setView((current) => ({
      ...current,
      versions: current.versions.map((value, index) =>
        index === current.tab ? versionCount : value,
      ),
      counts: current.counts.map((value, index) =>
        index === current.tab ? versionCount + 1 : value,
      ),
    }));
  };

  const proposeForActive = () => {
    proposingIndex.current = active;
    propose.execute({
      campaignId: props.campaignId,
      // onglet d'un groupe : message écrit pour ce groupe
      ...(perGroup && activeTab.key ? { groupKey: activeTab.key } : {}),
    });
  };

  /** l'onglet a au moins une version avec un texte */
  const tabFilled = (tab: number) =>
    Array.from({ length: MAX_VERSIONS_PER_GROUP }, (_, version) =>
      values.messages?.[slotIndex(tab, version)]?.body?.trim(),
    ).some(Boolean);

  const goNext = () => {
    if (isDirty) {
      setNextIntent(true);
      void submit();
    } else {
      router.push(props.nextHref);
    }
  };

  const activeValues = values.messages?.[active];
  const proposalVisible =
    proposal !== null &&
    proposal.index === active &&
    (activeValues?.subject ?? '') === proposal.proposed.subject &&
    (activeValues?.body ?? '') === proposal.proposed.body &&
    (activeValues?.short ?? '') === proposal.proposed.short;

  const registerField =
    (index: number, key: TextField, fieldRef: (element: unknown) => void) =>
    (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      fieldRef(element);
      fields.current[`messages.${index}.${key}`] = element;
    };

  const renderVersion = (index: number) => {
    const slotValues = values.messages?.[index];
    const body = slotValues?.body ?? '';
    const short = slotValues?.short ?? '';
    const subject = slotValues?.subject ?? '';
    const unknown = unknownVariables(`${subject} ${body} ${short}`);
    const companyMissing =
      !props.companyOptional &&
      ((body.trim() !== '' && !mentionsCompany(body, company)) ||
        (short.trim() !== '' && !mentionsCompany(short, company)));

    return (
      <div className={'flex flex-col gap-5'}>
        <FormField
          name={`messages.${index}.subject`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'outreach.messages.subjectLabel'} />
              </FormLabel>

              <FormControl>
                <Input
                  data-test={`messages.${index}-subject`}
                  maxLength={SUBJECT_MAX}
                  placeholder={t('subjectPlaceholder')}
                  {...field}
                  onFocus={() => (activeField.current[index] = 'subject')}
                  ref={registerField(index, 'subject', field.ref)}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name={`messages.${index}.body`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'campaigns.messages.bodyLabel'} />
              </FormLabel>

              <FormControl>
                <Textarea
                  data-test={`messages.${index}-body`}
                  className={'min-h-64'}
                  maxLength={BODY_MAX}
                  placeholder={t('bodyPlaceholder')}
                  {...field}
                  onFocus={() => (activeField.current[index] = 'body')}
                  ref={registerField(index, 'body', field.ref)}
                />
              </FormControl>

              <div
                className={
                  'text-muted-foreground flex justify-end text-xs tabular-nums'
                }
              >
                {t('charCount', { count: body.length, max: BODY_MAX })}
              </div>

              <FormMessage />
            </FormItem>
          )}
        />

        <InsertButtons
          withGroup={perGroup}
          onInsert={(token) => insertVariable(index, token)}
        />

        <FormField
          name={`messages.${index}.short`}
          render={({ field }) => (
            <FormItem
              className={'bg-muted/40 rounded-lg border border-dashed p-4'}
            >
              <div className={'flex items-center gap-2'}>
                <FormLabel>
                  <Trans i18nKey={'outreach.messages.shortLabel'} />
                </FormLabel>
                <InfoTip>
                  <Trans i18nKey={'outreach.messages.shortIntro'} />
                </InfoTip>
              </div>

              <FormControl>
                <Textarea
                  data-test={`messages.${index}-short`}
                  className={'bg-background min-h-20'}
                  maxLength={SHORT_BODY_MAX}
                  placeholder={t('shortPlaceholder')}
                  {...field}
                  onFocus={() => (activeField.current[index] = 'short')}
                  ref={registerField(index, 'short', field.ref)}
                />
              </FormControl>

              <div
                className={
                  'text-muted-foreground flex justify-end text-xs tabular-nums'
                }
              >
                {t('charCount', { count: short.length, max: SHORT_BODY_MAX })}
              </div>

              <FormMessage />
            </FormItem>
          )}
        />

        {companyMissing ? (
          <Alert
            className={alertExtras.warning}
            data-test={`messages.${index}-company-warning`}
          >
            <TriangleAlert className={'h-4'} />
            <AlertDescription className={'flex flex-col items-start gap-2'}>
              <Trans i18nKey={'outreach.messages.companyMissingWarning'} />
              <Button
                type={'button'}
                size={'sm'}
                variant={'outline'}
                data-test={`messages.${index}-insert-my-company`}
                onClick={() => insertVariable(index, 'my_company')}
              >
                <Plus />
                <Trans i18nKey={'campaigns.messages.insertMyCompany'} />
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {unknown.length > 0 ? (
          <Alert
            className={alertExtras.warning}
            data-test={`messages.${index}-unknown-warning`}
          >
            <TriangleAlert className={'h-4'} />
            <AlertDescription>
              <Trans
                i18nKey={'outreach.messages.unknownVariableWarning'}
                values={{ variables: unknown.join(', ') }}
              />
            </AlertDescription>
          </Alert>
        ) : null}

        <FormField
          name={`messages.${index}.name`}
          render={({ field }) => (
            <FormItem className={'max-w-sm'}>
              <FormLabel>
                <Trans i18nKey={'outreach.messages.nameLabel'} />
              </FormLabel>

              <FormControl>
                <Input
                  data-test={`messages.${index}-name`}
                  maxLength={100}
                  {...field}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    );
  };

  // aperçu sur une entreprise gardée du groupe ouvert, s'il y en a ; sinon sur celles de la campagne
  const groupProspects = activeTab.key
    ? (props.previewByGroup?.[activeTab.key] ?? [])
    : [];
  const previewProspects =
    groupProspects.length > 0 ? groupProspects : props.prospects;
  const previewBase =
    previewProspects.length > 0
      ? previewProspects[previewIndex % previewProspects.length]
      : undefined;
  // variable {groupe} : le nom du groupe de l'onglet ouvert (aucun groupe dans « Pour les autres » ni sans
  // « Un message par groupe » : la phrase qui la contient est retirée, comme pour le robot)
  const prospect = previewBase
    ? { ...previewBase, group: activeTab.key ? activeTab.label : null }
    : undefined;

  return (
    <Form {...form}>
      <div
        className={'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]'}
      >
        <form
          data-test={'campaign-messages-form'}
          className={'flex min-w-0 flex-col gap-4'}
          onSubmit={(event) => {
            setNextIntent(false);
            void submit(event);
          }}
        >
          {props.sender ? null : (
            <Alert
              className={alertExtras.warning}
              data-test={'messages-no-sender'}
            >
              <TriangleAlert className={'h-4'} />
              <AlertDescription className={'flex flex-wrap gap-x-2'}>
                <Trans i18nKey={'outreach.messages.noSenderWarning'} />
                <Link className={'underline'} href={props.senderHref}>
                  <Trans i18nKey={'outreach.messages.noSenderLink'} />
                </Link>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className={'flex items-center gap-2'}>
                <Trans i18nKey={'campaigns.messages.title'} />
                <InfoTip>
                  <span className={'flex flex-col gap-2'}>
                    <span>
                      <Trans i18nKey={'campaigns.messages.intro'} />
                    </span>
                    {perGroup ? (
                      <span>
                        <Trans i18nKey={'campaigns.messages.groupsHint'} />
                      </span>
                    ) : null}
                  </span>
                </InfoTip>
              </CardTitle>
            </CardHeader>

            <CardContent>
              {perGroup ? (
                <div
                  className={'mb-4 flex flex-col gap-2'}
                  data-test={'messages-groups'}
                >
                  <Tabs
                    value={String(view.tab)}
                    onValueChange={(value) =>
                      setView((current) => ({ ...current, tab: Number(value) }))
                    }
                  >
                    <TabsList
                      className={
                        'flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto'
                      }
                      aria-label={tm('groupsLabel')}
                    >
                      {tabs.map((tab, index) => (
                        <TabsTrigger
                          key={tab.key ?? '-'}
                          value={String(index)}
                          className={'flex-none'}
                          data-test={`messages-group-tab-${tab.key ?? 'others'}`}
                        >
                          {tab.label}
                          {tab.kept !== null ? (
                            <span
                              className={
                                'text-muted-foreground font-normal tabular-nums'
                              }
                            >
                              <Trans
                                i18nKey={'campaigns.companies.groups.kept'}
                                values={{ count: tab.kept }}
                              />
                            </span>
                          ) : null}
                          {tabFilled(index) ? ' •' : ''}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              ) : null}

              <Tabs
                value={String(active)}
                onValueChange={(value) =>
                  setActiveVersion(Number(value) - slotIndex(view.tab, 0))
                }
                className={'flex-col'}
              >
                <div
                  className={
                    'flex flex-wrap items-center justify-between gap-3'
                  }
                >
                  <div className={'flex items-center gap-1'}>
                    <TabsList
                      className={'flex-wrap'}
                      aria-label={tm('versionsLabel')}
                    >
                      {Array.from({ length: versionCount }, (_, index) => (
                        <TabsTrigger
                          key={slotIndex(view.tab, index)}
                          value={String(slotIndex(view.tab, index))}
                          data-test={`messages-tab-${index}`}
                        >
                          {tm('versionTab', { letter: versionLetter(index) })}
                          {values.messages?.[
                            slotIndex(view.tab, index)
                          ]?.body?.trim()
                            ? ' •'
                            : ''}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {versionCount < MAX_VERSIONS_PER_GROUP ? (
                      <Button
                        type={'button'}
                        size={'icon-sm'}
                        variant={'ghost'}
                        aria-label={tm('addVersion')}
                        title={tm('addVersion')}
                        data-test={'messages-add-version'}
                        onClick={addVersion}
                      >
                        <Plus />
                      </Button>
                    ) : null}
                  </div>

                  {props.sorted ? (
                    <Button
                      type={'button'}
                      variant={'outline'}
                      data-test={'messages-ai-propose'}
                      loading={propose.isPending}
                      disabled={saving}
                      onClick={proposeForActive}
                    >
                      <Sparkles />
                      <span>
                        {propose.isPending ? (
                          <Trans i18nKey={'campaigns.messages.ai.proposing'} />
                        ) : (
                          <Trans i18nKey={'campaigns.messages.ai.propose'} />
                        )}
                      </span>
                    </Button>
                  ) : null}
                </div>

                {proposalVisible && proposal ? (
                  <div
                    className={
                      'text-muted-foreground mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'
                    }
                    data-test={'messages-ai-proposed'}
                  >
                    <span>
                      <Trans i18nKey={'campaigns.messages.ai.proposed'} />
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      <Trans
                        i18nKey={'campaigns.messages.ai.remaining'}
                        values={{ count: proposal.remaining }}
                      />
                    </span>
                    <span aria-hidden>·</span>
                    <Button
                      type={'button'}
                      variant={'link'}
                      size={'sm'}
                      className={'h-auto px-0'}
                      data-test={'messages-ai-undo'}
                      onClick={() => {
                        writeText(proposal.index, proposal.previous);
                        setProposal(null);
                      }}
                    >
                      <Trans i18nKey={'campaigns.messages.ai.undo'} />
                    </Button>
                  </div>
                ) : null}

                {perGroup && !activeTab.key && !tabFilled(view.tab) ? (
                  <p
                    className={
                      'text-muted-foreground mt-3 flex items-start gap-2 text-sm'
                    }
                    data-test={'messages-group-empty'}
                  >
                    <TriangleAlert className={'mt-0.5 size-4 shrink-0'} />
                    <span>{tm('othersEmpty')}</span>
                  </p>
                ) : null}

                {Array.from({ length: versionCount }, (_, index) => (
                  <TabsContent
                    key={slotIndex(view.tab, index)}
                    value={String(slotIndex(view.tab, index))}
                    className={'pt-4'}
                  >
                    {renderVersion(slotIndex(view.tab, index))}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          {/* Réglages d'envoi (envois par jour, validation automatique) : dans Contacter → Avancé depuis le
              5/11/2026 (audit E10). Le formulaire garde leurs valeurs pour les renvoyer telles quelles. */}

          <div className={'flex justify-end'}>
            <Button
              type={'submit'}
              variant={'outline'}
              data-test={'messages-save-button'}
              loading={saving && !goingNext}
              disabled={saving}
            >
              <Trans i18nKey={'outreach.messages.save'} />
            </Button>
          </div>
        </form>

        <div className={'flex min-w-0 flex-col gap-4 lg:sticky lg:top-16'}>
          {props.senderCard}

          <Card data-test={'messages-preview'}>
            <CardHeader>
              <CardTitle className={'min-w-0 truncate text-base'}>
                <Trans i18nKey={'campaigns.messages.previewTitle'} />
                {prospect ? (
                  <span className={'text-muted-foreground font-normal'}>
                    {' · '}
                    {prospect.name}
                  </span>
                ) : null}
              </CardTitle>

              {previewProspects.length > 1 ? (
                <CardAction>
                  <Button
                    type={'button'}
                    size={'sm'}
                    variant={'ghost'}
                    data-test={'messages-preview-next'}
                    onClick={() => setPreviewIndex(previewIndex + 1)}
                  >
                    <Trans i18nKey={'campaigns.messages.previewOther'} />
                    <ChevronRight />
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>

            <CardContent className={'text-sm'}>
              {!prospect ? (
                <p
                  className={'text-muted-foreground'}
                  data-test={'messages-preview-empty'}
                >
                  {props.sorted ? (
                    <Trans i18nKey={'campaigns.messages.previewWaitingKept'} />
                  ) : (
                    <Trans i18nKey={'outreach.messages.previewEmpty'} />
                  )}
                </p>
              ) : (activeValues?.body ?? '').trim() === '' ? (
                <p className={'text-muted-foreground'}>
                  <Trans i18nKey={'outreach.messages.previewNoText'} />
                </p>
              ) : (
                <MessagePreview
                  prospect={prospect}
                  sender={props.sender}
                  subject={activeValues?.subject ?? ''}
                  body={activeValues?.body ?? ''}
                  short={activeValues?.short ?? ''}
                />
              )}
            </CardContent>
          </Card>

          <Button
            type={'button'}
            size={'lg'}
            className={'self-end'}
            data-test={'campaign-step-next'}
            loading={saving && goingNext}
            disabled={saving}
            onClick={goNext}
          >
            <span>
              <Trans i18nKey={'campaigns.messages.next'} />
            </span>
            <ArrowRight className={'w-4'} />
          </Button>
        </div>
      </div>
    </Form>
  );
}

/** Le formulaire de contact tel qu'il sera rempli pour une entreprise : vos coordonnées, l'objet, le message. */
function MessagePreview(props: {
  prospect: TemplateContext['prospect'];
  sender: TemplateContext['sender'];
  subject: string;
  body: string;
  short: string;
}) {
  const ctx = { prospect: props.prospect, sender: props.sender };
  const sender = props.sender;
  const empty = '—';

  const rows = [
    {
      key: 'name',
      value: sender
        ? `${sender.first_name} ${sender.last_name}`.trim() || empty
        : empty,
    },
    { key: 'company', value: sender?.company || empty },
    { key: 'email', value: sender?.email || empty },
    { key: 'phone', value: sender?.phone || empty },
  ] as const;

  return (
    <dl className={'flex flex-col gap-3'} data-test={'messages-preview-form'}>
      {rows.map((row) => (
        <div key={row.key} className={'grid grid-cols-[96px_1fr] gap-2'}>
          <dt className={'text-muted-foreground'}>
            <Trans i18nKey={`campaigns.messages.previewFields.${row.key}`} />
          </dt>
          <dd className={'min-w-0 break-words'}>{row.value}</dd>
        </div>
      ))}

      {props.subject.trim() !== '' ? (
        <div className={'grid grid-cols-[96px_1fr] gap-2'}>
          <dt className={'text-muted-foreground'}>
            <Trans i18nKey={'campaigns.messages.previewFields.subject'} />
          </dt>
          <dd className={'min-w-0 font-medium break-words'}>
            {renderTemplate(props.subject, ctx)}
          </dd>
        </div>
      ) : null}

      <div className={'flex flex-col gap-1.5'}>
        <dt className={'text-muted-foreground'}>
          <Trans i18nKey={'campaigns.messages.previewFields.message'} />
        </dt>
        <dd
          className={
            'bg-muted/40 rounded-lg border p-3 break-words whitespace-pre-wrap'
          }
        >
          {renderTemplate(props.body, ctx)}
        </dd>
      </div>

      {props.short.trim() !== '' ? (
        <div className={'flex flex-col gap-1.5'}>
          <dt className={'text-muted-foreground'}>
            <Trans i18nKey={'outreach.messages.shortLabel'} />
          </dt>
          <dd
            className={
              'rounded-lg border border-dashed p-3 break-words whitespace-pre-wrap'
            }
          >
            {renderTemplate(props.short, ctx)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** « Insérer : Entreprise / Ville / Activité », et les autres variables dans « Autres ». */
function InsertButtons(props: {
  onInsert: (token: string) => void;
  /** « Un message par groupe » : « Groupe » parmi les boutons principaux */
  withGroup: boolean;
}) {
  const t = useTranslations('outreach.messages');
  const main: readonly string[] = props.withGroup
    ? [...MAIN_VARIABLES, 'group']
    : MAIN_VARIABLES;

  const others = TEMPLATE_VARIABLES.filter(
    (variable) => !main.includes(variable.token),
  );
  const groups = [
    { key: 'prospect', label: 'variablesProspect' },
    { key: 'sender', label: 'variablesSender' },
  ] as const;

  return (
    <div
      className={'flex flex-wrap items-center gap-2'}
      data-test={'messages-insert'}
    >
      <span className={'text-muted-foreground text-sm'}>
        <Trans i18nKey={'campaigns.messages.insert'} />
      </span>

      {main.map((token) => (
        <Button
          key={token}
          type={'button'}
          size={'sm'}
          variant={'outline'}
          data-test={`insert-${token}`}
          // garde le curseur dans la zone de texte : le clic ne lui retire pas le focus
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onInsert(token)}
        >
          <Trans i18nKey={`campaigns.messages.insertVariables.${token}`} />
        </Button>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type={'button'}
              size={'sm'}
              variant={'ghost'}
              data-test={'insert-more'}
            />
          }
        >
          <Trans i18nKey={'campaigns.messages.insertMore'} />
          <ChevronDown />
        </DropdownMenuTrigger>

        <DropdownMenuContent align={'start'} className={'min-w-52'}>
          {groups.map((group, groupIndex) => (
            <DropdownMenuGroup key={group.key}>
              {groupIndex > 0 ? <DropdownMenuSeparator /> : null}

              <DropdownMenuLabel>{t(group.label)}</DropdownMenuLabel>

              {others
                .filter((variable) => variable.group === group.key)
                .map((variable) => (
                  <DropdownMenuItem
                    key={variable.token}
                    data-test={`insert-${variable.token}`}
                    onClick={() => props.onInsert(variable.token)}
                  >
                    {t(`var.${variable.token}`)}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
