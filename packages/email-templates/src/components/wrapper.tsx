import { Container } from 'react-email';

import { emailTheme } from './theme';

export function EmailWrapper(
  props: React.PropsWithChildren<{
    className?: string;
  }>,
) {
  return (
    <Container
      style={{
        backgroundColor: emailTheme.background,
        margin: 'auto',
        fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif",
        color: emailTheme.text,
        width: '100%',
      }}
    >
      <Container
        style={{
          maxWidth: '560px',
          backgroundColor: emailTheme.background,
          margin: '0 auto',
          padding: '32px 20px',
        }}
      >
        {props.children}
      </Container>
    </Container>
  );
}
