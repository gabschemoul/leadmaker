/**
 * Prospectigo (8/11/2026) — socle visuel de l'appli, façon ElevenLabs / Apollo :
 * panneaux arrondis 12 px, bord fin à ~8 % (jeton `border`), sans ombre, marge intérieure 20 px.
 * Enveloppe la primitive shadcn (laissée intacte pour rester remplaçable par le CLI) ;
 * `cn()` fait gagner le `className` du point d'appel.
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import {
  Card as ShadcnCard,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader as ShadcnCardHeader,
  CardTitle,
} from '../shadcn/card';

function Card({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnCard>) {
  return (
    <ShadcnCard
      className={cn(
        'ring-border rounded-xl [--card-spacing:--spacing(5)] data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnCardHeader>) {
  return (
    <ShadcnCardHeader className={cn('rounded-t-xl', className)} {...props} />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
