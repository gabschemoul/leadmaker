import { Text } from 'react-email';

import { emailTheme } from './theme';

/**
 * Logo Prospectigo « le dernier o » (3/11/2026), comme dans l'application
 * (apps/web/components/app-logo.tsx) : le o final du nom devient un rond
 * orange, avec un petit trait en dessous. Dessiné avec des blocs colorés et
 * du texte, pas d'image : il s'affiche même quand le client mail bloque les
 * images.
 */
export function EmailLogo({ productName }: { productName: string }) {
  const endsWithO = productName.endsWith('o');
  const name = endsWithO ? productName.slice(0, -1) : productName;

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
      {name}
      {endsWithO ? (
        <span
          style={{
            display: 'inline-block',
            width: '12px',
            marginLeft: '1px',
            verticalAlign: '-5px',
          }}
        >
          <span
            style={{
              display: 'block',
              width: '12px',
              height: '12px',
              borderRadius: '12px',
              backgroundColor: emailTheme.brand,
            }}
          />
          <span
            style={{
              display: 'block',
              width: '6px',
              height: '2px',
              margin: '3px auto 0 auto',
              backgroundColor: emailTheme.ink,
            }}
          />
        </span>
      ) : null}
    </Text>
  );
}
