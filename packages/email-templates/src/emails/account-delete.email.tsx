import { Body, Head, Html, Preview, Text, render } from 'react-email';

import { BodyStyle } from '../components/body-style';
import { EmailContent } from '../components/content';
import { EmailFooter } from '../components/footer';
import { EmailHeader } from '../components/header';
import { EmailHeading } from '../components/heading';
import { emailTheme } from '../components/theme';
import { EmailWrapper } from '../components/wrapper';
import { initializeEmailI18n } from '../lib/i18n';

interface Props {
  productName: string;
  language?: string;
}

const paragraph = {
  margin: '0 0 14px 0',
  fontSize: '16px',
  lineHeight: '24px',
  color: emailTheme.text,
} as const;

export async function renderAccountDeleteEmail(props: Props) {
  const namespace = 'account-delete-email';

  const { t } = await initializeEmailI18n({
    language: props.language,
    namespace,
  });

  const previewText = t(`previewText`, {
    productName: props.productName,
  });

  const subject = t(`subject`, {
    productName: props.productName,
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
            <EmailHeading>{previewText}</EmailHeading>
          </EmailHeader>

          <EmailContent>
            <Text style={paragraph}>{t(`hello`)}</Text>

            <Text style={paragraph}>
              {t(`paragraph1`, {
                productName: props.productName,
              })}
            </Text>

            <Text style={paragraph}>{t(`paragraph2`)}</Text>

            <Text style={paragraph}>
              {t(`paragraph3`, {
                productName: props.productName,
              })}
            </Text>

            <Text style={{ ...paragraph, margin: 0 }}>
              {t(`paragraph4`, {
                productName: props.productName,
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
