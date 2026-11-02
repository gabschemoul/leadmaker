import { Body, Head, Html, Preview, Section, Text, render } from 'react-email';

import { BodyStyle } from '../components/body-style';
import { EmailContent } from '../components/content';
import { EmailFooter } from '../components/footer';
import { EmailHeader } from '../components/header';
import { EmailHeading } from '../components/heading';
import { emailTheme } from '../components/theme';
import { EmailWrapper } from '../components/wrapper';
import { initializeEmailI18n } from '../lib/i18n';

interface Props {
  otp: string;
  productName: string;
  language?: string;
}

const paragraph = {
  margin: '0 0 14px 0',
  fontSize: '16px',
  lineHeight: '24px',
  color: emailTheme.text,
} as const;

export async function renderOtpEmail(props: Props) {
  const namespace = 'otp-email';

  const { t } = await initializeEmailI18n({
    language: props.language,
    namespace,
  });

  const subject = t(`subject`, {
    productName: props.productName,
  });

  const previewText = subject;

  const heading = t(`heading`, {
    productName: props.productName,
  });

  const otpText = t(`otpText`, {
    otp: props.otp,
  });

  const mainText = t(`mainText`, {
    productName: props.productName,
  });

  const footerText = t(`footerText`);

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
            <Text style={paragraph}>{mainText}</Text>

            <Text style={paragraph}>{otpText}</Text>

            <Section
              style={{
                margin: '16px 0',
                padding: '16px 8px',
                textAlign: 'center',
                backgroundColor: emailTheme.codeBackground,
                borderRadius: '8px',
              }}
            >
              <Text
                style={{
                  margin: 0,
                  fontSize: '30px',
                  lineHeight: '36px',
                  fontWeight: 600,
                  letterSpacing: '4px',
                  color: emailTheme.ink,
                }}
              >
                {props.otp}
              </Text>
            </Section>

            <Text style={{ ...paragraph, margin: 0, color: emailTheme.muted }}>
              {footerText}
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
