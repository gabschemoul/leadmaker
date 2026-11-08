/**
 * Prospectigo (8/11/2026) — zone de texte alignée sur les champs (marge intérieure 12 px).
 * Enveloppe la primitive shadcn (laissée intacte) ; `cn()` fait gagner le `className` du point d'appel.
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { Textarea as ShadcnTextarea } from '../shadcn/textarea';

function Textarea({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnTextarea>) {
  return <ShadcnTextarea className={cn('px-3', className)} {...props} />;
}

export { Textarea };
