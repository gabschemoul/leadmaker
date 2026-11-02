import { Heading } from 'react-email';

import { emailTheme } from './theme';

export function EmailHeading(props: React.PropsWithChildren) {
  return (
    <Heading
      style={{
        margin: '0 0 16px 0',
        padding: 0,
        fontSize: '22px',
        lineHeight: '28px',
        fontWeight: 700,
        color: emailTheme.ink,
      }}
    >
      {props.children}
    </Heading>
  );
}
