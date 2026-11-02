import { Container, Section } from 'react-email';

import { EmailLogo } from './logo';

export function EmailHeader(
  props: React.PropsWithChildren<{ productName?: string }>,
) {
  return (
    <Container>
      <Section>
        {props.productName ? (
          <EmailLogo productName={props.productName} />
        ) : null}

        {props.children}
      </Section>
    </Container>
  );
}
