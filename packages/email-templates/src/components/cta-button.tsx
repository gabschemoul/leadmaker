import { Button } from 'react-email';

import { emailTheme } from './theme';

export function CtaButton(
  props: React.PropsWithChildren<{
    href: string;
  }>,
) {
  return (
    <Button
      href={props.href}
      style={{
        display: 'inline-block',
        width: '100%',
        boxSizing: 'border-box',
        padding: '13px 20px',
        borderRadius: '8px',
        backgroundColor: emailTheme.primary,
        color: emailTheme.primaryText,
        fontSize: '16px',
        fontWeight: 600,
        textAlign: 'center',
        textDecoration: 'none',
      }}
    >
      {props.children}
    </Button>
  );
}
