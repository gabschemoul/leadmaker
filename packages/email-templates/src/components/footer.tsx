import { Container, Text } from 'react-email';

import { emailTheme } from './theme';

export function EmailFooter(props: React.PropsWithChildren) {
  return (
    <Container>
      <Text
        style={{
          margin: '16px 0 0 0',
          padding: '0 8px',
          fontSize: '12px',
          lineHeight: '20px',
          color: emailTheme.faint,
        }}
      >
        {props.children}
      </Text>
    </Container>
  );
}
