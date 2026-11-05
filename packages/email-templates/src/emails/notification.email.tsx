import { Body, Head, Html, Preview, Text, render } from 'react-email';

import { BodyStyle } from '../components/body-style';
import { EmailContent } from '../components/content';
import { CtaButton } from '../components/cta-button';
import { EmailFooter } from '../components/footer';
import { EmailHeader } from '../components/header';
import { EmailHeading } from '../components/heading';
import { emailTheme } from '../components/theme';
import { EmailWrapper } from '../components/wrapper';
import { initializeEmailI18n } from '../lib/i18n';

/**
 * Prospectigo : e-mails de notification (recherche terminée, crédits bas, pilote automatique…, 5/11/2026).
 * Un seul gabarit ; le texte de chaque type est dans locales/<langue>/notification-email.json (clé = `kind`).
 * Envoyés par apps/web/app/api/notifications/dispatch (file lm_notifications).
 */
export type NotificationEmailKind =
  | 'autopilotPreviewReady'
  | 'autopilotDoneTarget'
  | 'autopilotDoneEmpty'
  | 'searchDone'
  | 'searchNoCredits'
  | 'creditsLowDiscovery'
  | 'creditsLowOutreach'
  | 'adminSignup'
  | 'adminSubscriptionNew'
  | 'adminSubscriptionCanceled'
  | 'adminPaymentFailed';

interface Props {
  kind: NotificationEmailKind;
  productName: string;
  language?: string;
  /** valeurs des textes : campagne, nombres, dates déjà formatées… (échappées par React) */
  values: Record<string, string | number>;
  ctaUrl: string;
  /** lien vers la page où couper ces e-mails (absent pour les notifications internes) */
  settingsUrl?: string;
}

const paragraph = {
  margin: '0 0 14px 0',
  fontSize: '16px',
  lineHeight: '24px',
  color: emailTheme.text,
} as const;

export async function renderNotificationEmail(props: Props) {
  const { t } = await initializeEmailI18n({
    language: props.language,
    namespace: 'notification-email',
  });

  const values = { productName: props.productName, ...props.values };
  const subject = t(`${props.kind}.subject`, values);
  const heading = t(`${props.kind}.heading`, values);

  const html = await render(
    <Html>
      <Head>
        <BodyStyle />
      </Head>

      <Preview>{heading}</Preview>

      <Body>
        <EmailWrapper>
          <EmailHeader productName={props.productName}>
            <EmailHeading>{heading}</EmailHeading>
          </EmailHeader>

          <EmailContent>
            <Text style={paragraph}>{t('hello')}</Text>

            <Text style={paragraph}>{t(`${props.kind}.body`, values)}</Text>

            <CtaButton href={props.ctaUrl}>
              {t(`${props.kind}.cta`, values)}
            </CtaButton>
          </EmailContent>

          <EmailFooter>
            {props.settingsUrl
              ? t('footerSettings', {
                  ...values,
                  settingsUrl: props.settingsUrl,
                })
              : props.productName}
          </EmailFooter>
        </EmailWrapper>
      </Body>
    </Html>,
  );

  return { html, subject };
}
