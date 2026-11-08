'use client';

/**
 * Prospectigo (8/11/2026) — interrupteur bleu Klein quand il est activé, comme dans la fenêtre
 * d'appli de la page d'accueil. Enveloppe la primitive shadcn (laissée intacte).
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { Switch as ShadcnSwitch } from '../shadcn/switch';

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnSwitch>) {
  return (
    <ShadcnSwitch
      className={cn(
        'data-checked:bg-brand dark:data-checked:bg-brand [&_[data-slot=switch-thumb]]:dark:data-checked:bg-white',
        className,
      )}
      {...props}
    />
  );
}

export { Switch };
