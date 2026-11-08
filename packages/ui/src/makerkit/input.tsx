/**
 * Prospectigo (8/11/2026) — champs de 36 px avec marge intérieure 12 px (socle appli).
 * Enveloppe la primitive shadcn (laissée intacte) ; `cn()` fait gagner le `className` du point d'appel.
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { Input as ShadcnInput } from '../shadcn/input';

function Input({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnInput>) {
  return <ShadcnInput className={cn('h-9 px-3', className)} {...props} />;
}

export { Input };
