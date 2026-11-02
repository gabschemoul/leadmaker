import { Container } from 'react-email';

import { emailTheme } from './theme';

export function EmailContent({
  children,
}: React.PropsWithChildren<{
  className?: string;
  displayLogo?: boolean;
}>) {
  return (
    <Container
      style={{
        backgroundColor: emailTheme.card,
        border: `1px solid ${emailTheme.border}`,
        borderRadius: '12px',
        padding: '28px 32px',
        margin: '0 auto',
      }}
    >
      {children}
    </Container>
  );
}
