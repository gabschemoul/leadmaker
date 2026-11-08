'use client';

/**
 * Prospectigo (8/11/2026) — case à cocher bleu Klein quand elle est cochée (charte du site).
 * Enveloppe la primitive shadcn (laissée intacte).
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { Checkbox as ShadcnCheckbox } from '../shadcn/checkbox';

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnCheckbox>) {
  return (
    <ShadcnCheckbox
      className={cn(
        'data-checked:border-brand data-checked:bg-brand data-checked:text-brand-foreground dark:data-checked:bg-brand',
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
