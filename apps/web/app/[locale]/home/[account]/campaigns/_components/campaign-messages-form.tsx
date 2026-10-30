'use client';

import { useRef, useState } from 'react';

import Link from 'next/link';

import { zodResolver } from '@hookform/resolvers/zod';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm, useWatch } from 'react-hook-form';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
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
import { Switch } from '@kit/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Textarea } from '@kit/ui/textarea';
import { Trans } from '@kit/ui/trans';

import {
  BODY_MAX,
  type CampaignTemplates,
  MAX_MESSAGES,
  SHORT_BODY_MAX,
  SUBJECT_MAX,
  TEMPLATE_VARIABLES,
  type TemplateContext,
  mentionsCompany,
  renderTemplate,
  unknownVariables,
} from '~/lib/leadmaker/templates';

import {
  CampaignTemplatesFormSchema,
  DAILY_LIMIT_MAX,
} from '../_lib/schema/templates.schema';
import { saveCampaignTemplatesAction } from '../_lib/server/server-actions';

type PreviewProspect = TemplateContext['prospect'] & { id: string };

type Slot = `messages.${number}` | 'short';

export function CampaignMessagesForm(props: {
  accountId: string;
  campaignId: string;
  templates: CampaignTemplates;
  sender: TemplateContext['sender'];
  senderHref: string;
  prospects: PreviewProspect[];
  sending: {
    dailyLimit: number;
    autoValidation: boolean;
    /** le forfait de l'organisation inclut la validation automatique */
    autoValidationAllowed: boolean;
  };
}) {
  const t = useTranslations('outreach.messages');

  const { execute, isPending } = useAction(saveCampaignTemplatesAction, {
    onSuccess: ({ data }) =>
      toast.success(t('saved', { count: data?.count ?? 0 })),
    onError: ({ error }) =>
      toast.error(
        t(error.serverError?.replace('outreach.messages.', '') ?? 'saveFailed'),
      ),
  });

  const form = useForm({
    resolver: zodResolver(CampaignTemplatesFormSchema),
    defaultValues: {
      messages: Array.from({ length: MAX_MESSAGES }, (_, index) => ({
        name: props.templates.messages[index]?.name ?? `Message ${index + 1}`,
        subject: props.templates.messages[index]?.subject ?? '',
        body: props.templates.messages[index]?.body ?? '',
      })),
      short: props.templates.short,
      dailyLimit: props.sending.dailyLimit,
      autoValidation: props.sending.autoValidation,
    },
  });

  const values = useWatch({ control: form.control });
  const [previewIndex, setPreviewIndex] = useState(0);
  const textareas = useRef<Partial<Record<Slot, HTMLTextAreaElement | null>>>(
    {},
  );

  const disabled = isPending || form.formState.isSubmitting;
  const company = props.sender?.company ?? null;

  /** Insère une variable à l'endroit du curseur de la zone de texte du message. */
  const insertVariable = (slot: Slot, token: string) => {
    const field = `${slot}.body` as const;
    const current = (form.getValues(field) as string) ?? '';
    const element = textareas.current[slot];
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}{${token}}${current.slice(end)}`;

    form.setValue(field, next, { shouldDirty: true });

    requestAnimationFrame(() => {
      element?.focus();
      const cursor = start + token.length + 2;
      element?.setSelectionRange(cursor, cursor);
    });
  };

  const prospect = props.prospects[previewIndex] ?? props.prospects[0];

  const renderSlot = (slot: Slot, max: number) => {
    const slotValues =
      slot === 'short'
        ? values.short
        : values.messages?.[Number(slot.split('.')[1])];
    const body = slotValues?.body ?? '';
    const subject = slotValues?.subject ?? '';
    const unknown = unknownVariables(`${subject} ${body}`);
    const companyMissing =
      body.trim() !== '' && !mentionsCompany(body, company);

    return (
      <div className={'flex flex-col gap-6'}>
        {slot === 'short' ? (
          <p className={'text-muted-foreground text-sm'}>
            <Trans i18nKey={'outreach.messages.shortIntro'} />
          </p>
        ) : (
          <FormField
            name={`${slot}.name`}
            render={({ field }) => (
              <FormItem className={'max-w-sm'}>
                <FormLabel>
                  <Trans i18nKey={'outreach.messages.nameLabel'} />
                </FormLabel>

                <FormControl>
                  <Input
                    data-test={`${slot}-name`}
                    maxLength={100}
                    {...field}
                  />
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          name={`${slot}.subject`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'outreach.messages.subjectLabel'} />
              </FormLabel>

              <FormControl>
                <Input
                  data-test={`${slot}-subject`}
                  maxLength={SUBJECT_MAX}
                  placeholder={t('subjectPlaceholder')}
                  {...field}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name={`${slot}.body`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey={'outreach.messages.bodyLabel'} />
              </FormLabel>

              <FormControl>
                <Textarea
                  data-test={`${slot}-body`}
                  className={'min-h-48'}
                  maxLength={max}
                  placeholder={t('bodyPlaceholder')}
                  {...field}
                  ref={(element) => {
                    field.ref(element);
                    textareas.current[slot] = element;
                  }}
                />
              </FormControl>

              <div
                className={
                  'text-muted-foreground flex justify-end text-xs tabular-nums'
                }
              >
                {t('charCount', { count: body.length, max })}
              </div>

              <FormMessage />
            </FormItem>
          )}
        />

        <VariableButtons onInsert={(token) => insertVariable(slot, token)} />

        {companyMissing ? (
          <Alert
            className={alertExtras.warning}
            data-test={`${slot}-company-warning`}
          >
            <TriangleAlert className={'h-4'} />
            <AlertDescription>
              <Trans i18nKey={'outreach.messages.companyMissingWarning'} />
            </AlertDescription>
          </Alert>
        ) : null}

        {unknown.length > 0 ? (
          <Alert
            className={alertExtras.warning}
            data-test={`${slot}-unknown-warning`}
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

        <Card data-test={`${slot}-preview`}>
          <CardHeader>
            <CardTitle className={'text-base'}>
              <Trans i18nKey={'outreach.messages.previewTitle'} />
            </CardTitle>

            <CardDescription>
              <Trans i18nKey={'outreach.messages.previewDescription'} />
            </CardDescription>
          </CardHeader>

          <CardContent className={'flex flex-col gap-4'}>
            {props.prospects.length === 0 ? (
              <p className={'text-muted-foreground text-sm'}>
                <Trans i18nKey={'outreach.messages.previewEmpty'} />
              </p>
            ) : (
              <>
                <div className={'flex flex-wrap gap-2'}>
                  {props.prospects.map((item, index) => (
                    <Button
                      key={item.id}
                      type={'button'}
                      size={'sm'}
                      variant={index === previewIndex ? 'default' : 'outline'}
                      data-test={`preview-prospect-${index}`}
                      onClick={() => setPreviewIndex(index)}
                    >
                      {item.name}
                    </Button>
                  ))}
                </div>

                {body.trim() === '' ? (
                  <p className={'text-muted-foreground text-sm'}>
                    <Trans i18nKey={'outreach.messages.previewNoText'} />
                  </p>
                ) : prospect ? (
                  <div
                    className={
                      'bg-muted/40 flex flex-col gap-2 rounded-lg border p-4 text-sm'
                    }
                  >
                    {subject.trim() !== '' ? (
                      <p className={'font-medium'}>
                        <Trans i18nKey={'outreach.messages.previewSubject'} />{' '}
                        {renderTemplate(subject, {
                          prospect,
                          sender: props.sender,
                        })}
                      </p>
                    ) : null}

                    <p className={'whitespace-pre-wrap'}>
                      {renderTemplate(body, { prospect, sender: props.sender })}
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <Form {...form}>
      <form
        data-test={'campaign-messages-form'}
        className={'flex flex-col gap-6'}
        onSubmit={form.handleSubmit((data) =>
          execute({
            ...data,
            accountId: props.accountId,
            campaignId: props.campaignId,
          }),
        )}
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
            <CardTitle>
              <Trans i18nKey={'outreach.messages.title'} />
            </CardTitle>

            <CardDescription>
              <Trans i18nKey={'outreach.messages.intro'} />
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Tabs defaultValue={'messages.0'} className={'flex-col'}>
              <TabsList className={'flex-wrap'}>
                {Array.from({ length: MAX_MESSAGES }, (_, index) => (
                  <TabsTrigger
                    key={index}
                    value={`messages.${index}`}
                    data-test={`messages-tab-${index}`}
                  >
                    {t('messageTab', { index: index + 1 })}
                    {values.messages?.[index]?.body?.trim() ? ' •' : ''}
                  </TabsTrigger>
                ))}

                <TabsTrigger value={'short'} data-test={'messages-tab-short'}>
                  {t('shortTab')}
                  {values.short?.body?.trim() ? ' •' : ''}
                </TabsTrigger>
              </TabsList>

              {Array.from({ length: MAX_MESSAGES }, (_, index) => (
                <TabsContent
                  key={index}
                  value={`messages.${index}`}
                  className={'pt-4'}
                >
                  {renderSlot(`messages.${index}`, BODY_MAX)}
                </TabsContent>
              ))}

              <TabsContent value={'short'} className={'pt-4'}>
                {renderSlot('short', SHORT_BODY_MAX)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card data-test={'campaign-sending-card'}>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey={'outreach.messages.sending.title'} />
            </CardTitle>

            <CardDescription>
              <Trans i18nKey={'outreach.messages.sending.intro'} />
            </CardDescription>
          </CardHeader>

          <CardContent className={'flex flex-col gap-6'}>
            <FormField
              name={'dailyLimit'}
              render={({ field }) => (
                <FormItem className={'max-w-xs'}>
                  <FormLabel>
                    <Trans i18nKey={'outreach.messages.sending.dailyLimit'} />
                  </FormLabel>

                  <FormControl>
                    <Input
                      type={'number'}
                      min={1}
                      max={DAILY_LIMIT_MAX}
                      data-test={'sending-daily-limit'}
                      {...field}
                    />
                  </FormControl>

                  <p className={'text-muted-foreground text-sm'}>
                    <Trans
                      i18nKey={'outreach.messages.sending.dailyLimitHint'}
                    />
                  </p>

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name={'autoValidation'}
              render={({ field }) => (
                <FormItem>
                  <div className={'flex items-start gap-3'}>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!props.sending.autoValidationAllowed}
                        data-test={'sending-auto-validation'}
                      />
                    </FormControl>

                    <div className={'flex flex-col gap-1'}>
                      <FormLabel>
                        <Trans
                          i18nKey={'outreach.messages.sending.autoValidation'}
                        />
                      </FormLabel>

                      <p className={'text-muted-foreground text-sm'}>
                        <Trans
                          i18nKey={
                            props.sending.autoValidationAllowed
                              ? 'outreach.messages.sending.autoValidationHint'
                              : 'outreach.messages.sending.autoValidationPlanHint'
                          }
                        />
                      </p>
                    </div>
                  </div>

                  <FormMessage />
                </FormItem>
              )}
            />

            {values.autoValidation ? (
              <Alert
                className={alertExtras.warning}
                data-test={'sending-auto-validation-warning'}
              >
                <TriangleAlert className={'h-4'} />
                <AlertDescription>
                  <Trans
                    i18nKey={'outreach.messages.sending.autoValidationWarning'}
                  />
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <div className={'flex justify-end'}>
          <Button
            type={'submit'}
            data-test={'messages-save-button'}
            disabled={disabled}
          >
            <Trans i18nKey={'outreach.messages.save'} />
          </Button>
        </div>
      </form>
    </Form>
  );
}

function VariableButtons(props: { onInsert: (token: string) => void }) {
  const t = useTranslations('outreach.messages');

  const groups = [
    { key: 'prospect', label: 'variablesProspect' },
    { key: 'sender', label: 'variablesSender' },
  ] as const;

  return (
    <div className={'flex flex-col gap-2'}>
      <span className={'text-sm font-medium'}>
        <Trans i18nKey={'outreach.messages.variablesTitle'} />
      </span>

      {groups.map((group) => (
        <div key={group.key} className={'flex flex-wrap items-center gap-2'}>
          <span className={'text-muted-foreground w-40 text-xs'}>
            {t(group.label)}
          </span>

          {TEMPLATE_VARIABLES.filter(
            (variable) => variable.group === group.key,
          ).map((variable) => (
            <Button
              key={variable.token}
              type={'button'}
              size={'sm'}
              variant={'outline'}
              data-test={`insert-${variable.token}`}
              onClick={() => props.onInsert(variable.token)}
            >
              {t(`var.${variable.token}`)}
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}
