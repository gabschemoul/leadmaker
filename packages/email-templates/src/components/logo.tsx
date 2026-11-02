import { Text } from 'react-email';

import { emailTheme } from './theme';

/**
 * Logo texte « Prospectigo » avec le point jaune, comme dans l'application
 * (apps/web/components/app-logo.tsx). Un texte s'affiche même quand le client
 * mail bloque les images.
 */
export function EmailLogo({ productName }: { productName: string }) {
  return (
    <Text
      style={{
        margin: '0 0 20px 0',
        fontSize: '22px',
        lineHeight: '28px',
        fontWeight: 800,
        letterSpacing: '-0.5px',
        color: emailTheme.ink,
      }}
    >
      {productName}
      <span
        style={{
          display: 'inline-block',
          width: '7px',
          height: '7px',
          marginLeft: '3px',
          borderRadius: '7px',
          backgroundColor: emailTheme.brand,
        }}
      />
    </Text>
  );
}
