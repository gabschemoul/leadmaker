import { Img, Text } from 'react-email';

import { emailTheme } from './theme';

/** Étoile bleue du logo, servie par le site (32 × 32, affichée en 8 × 8). */
const STAR_URL = 'https://prospectigo.com/images/logo/etoile-email.png';

/**
 * Logo Prospectigo « i baguette » (10/11/2026), comme dans l'application
 * (apps/web/components/app-logo.tsx) : le i devient une baguette, son point
 * est remplacé par une petite étoile bleue. Le texte reste du texte : on
 * empile l'étoile au-dessus d'un i sans point (ı). Si le client mail bloque
 * les images, un astérisque bleu prend la place de l'étoile.
 * L'ancien logo « le dernier o » est dans logo-archive-dernier-o.tsx.
 */
export function EmailLogo({ productName }: { productName: string }) {
  const at = productName.lastIndexOf('i');
  const before = at >= 0 ? productName.slice(0, at) : productName;
  const after = at >= 0 ? productName.slice(at + 1) : '';

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
      {before}
      {at >= 0 ? (
        <span
          style={{
            display: 'inline-block',
            verticalAlign: 'baseline',
            textAlign: 'center',
          }}
        >
          <Img
            src={STAR_URL}
            width={8}
            height={8}
            alt={'*'}
            style={{
              display: 'block',
              width: '8px',
              height: '8px',
              margin: '0 auto',
              border: 0,
              color: emailTheme.brand,
              fontSize: '12px',
              lineHeight: '8px',
            }}
          />
          <span style={{ display: 'block', lineHeight: '12px' }}>ı</span>
        </span>
      ) : null}
      {after}
    </Text>
  );
}
