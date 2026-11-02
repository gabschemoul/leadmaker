import { Text } from 'react-email';

import { emailTheme } from './theme';

/**
 * Logo Prospectigo « Le repère » (2/11/2026), comme dans l'application
 * (apps/web/components/app-logo.tsx) : une barre surmontée d'un point orange,
 * puis le nom. Dessiné avec des blocs colorés et du texte, pas d'image : il
 * s'affiche même quand le client mail bloque les images.
 */
export function EmailLogo({ productName }: { productName: string }) {
  return (
    <Text
      style={{
        margin: '0 0 20px 0',
        fontSize: '22px',
        lineHeight: '28px',
        fontWeight: 700,
        letterSpacing: '-0.5px',
        color: emailTheme.ink,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          marginRight: '4px',
          verticalAlign: 'baseline',
        }}
      >
        <span
          style={{
            display: 'block',
            width: '6px',
            height: '6px',
            borderRadius: '6px',
            backgroundColor: emailTheme.brand,
          }}
        />
        <span
          style={{
            display: 'block',
            width: '3px',
            height: '8px',
            margin: '2px auto 0 auto',
            backgroundColor: emailTheme.ink,
          }}
        />
      </span>
      {productName}
    </Text>
  );
}
