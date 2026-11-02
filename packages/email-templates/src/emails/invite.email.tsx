import {
  Body,
  Column,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
  render,
} from 'react-email';

import { BodyStyle } from '../components/body-style';
import { EmailContent } from '../components/content';
import { CtaButton } from '../components/cta-button';
import { EmailFooter } from '../components/footer';
import { EmailHeader } from '../components/header';
import { EmailHeading } from '../components/heading';
import { emailTheme } from '../components/theme';
import { EmailWrapper } from '../components/wrapper';
import { escapeHtml } from '../lib/escape-html';
import { initializeEmailI18n } from '../lib/i18n';

interface Props {
  teamName: string;
  teamLogo?: string;
  inviter: string | undefined;
  invitedUserEmail: string;
  link: string;
  productName: string;
  language?: string;
}

const paragraph = {
  margin: '0 0 14px 0',
  fontSize: '16px',
  lineHeight: '24px',
  color: emailTheme.text,
} as const;

export async function renderInviteEmail(props: Props) {
  const namespace = 'invite-email';

  const { t } = await initializeEmailI18n({
    language: props.language,
    namespace,
  });

  const subject = t(`subject`, {
    teamName: props.teamName,
    productName: props.productName,
  });

  const previewText = subject;

  const heading = t(`heading`, {
    teamName: props.teamName,
    productName: props.productName,
  });

  const hello = t(`hello`, {
    invitedUserEmail: props.invitedUserEmail,
  });

  // `mainText` is rendered via `dangerouslySetInnerHTML`, so user-controlled
  // values must be HTML-escaped before interpolation. The other fields below
  // render through JSX (auto-escaped) and must NOT be escaped here to avoid
  // double-escaping.
  const mainText = t(`mainText`, {
    inviter: escapeHtml(props.inviter),
    teamName: escapeHtml(props.teamName),
    productName: escapeHtml(props.productName),
    strong: (chunks: string) => `<strong>${chunks}</strong>`,
  });

  const joinTeam = t(`joinTeam`, {
    teamName: props.teamName,
  });

  const html = await render(
    <Html>
      <Head>
        <BodyStyle />
      </Head>

      <Preview>{previewText}</Preview>

      <Body>
        <EmailWrapper>
          <EmailHeader productName={props.productName}>
            <EmailHeading>{heading}</EmailHeading>
          </EmailHeader>

          <EmailContent>
            <Text style={paragraph}>{hello}</Text>

            <Text
              style={paragraph}
              dangerouslySetInnerHTML={{ __html: mainText }}
            />

            {props.teamLogo && (
              <Section>
                <Row>
                  <Column align="center">
                    <Img
                      style={{ borderRadius: '32px' }}
                      src={props.teamLogo}
                      width="64"
                      height="64"
                    />
                  </Column>
                </Row>
              </Section>
            )}

            <Section style={{ margin: '24px 0', textAlign: 'center' }}>
              <CtaButton href={props.link}>{joinTeam}</CtaButton>
            </Section>

            <Text
              style={{
                ...paragraph,
                fontSize: '14px',
                lineHeight: '22px',
                color: emailTheme.muted,
              }}
            >
              {t(`copyPasteLink`)}{' '}
              <Link
                href={props.link}
                style={{ color: emailTheme.primary, wordBreak: 'break-all' }}
              >
                {props.link}
              </Link>
            </Text>

            <Hr
              style={{
                margin: '20px 0',
                border: 'none',
                borderTop: `1px solid ${emailTheme.border}`,
              }}
            />

            <Text
              style={{
                margin: 0,
                fontSize: '12px',
                lineHeight: '20px',
                color: emailTheme.muted,
              }}
            >
              {t(`invitationIntendedFor`, {
                invitedUserEmail: props.invitedUserEmail,
              })}
            </Text>
          </EmailContent>

          <EmailFooter>{props.productName}</EmailFooter>
        </EmailWrapper>
      </Body>
    </Html>,
  );

  return {
    html,
    subject,
  };
}
