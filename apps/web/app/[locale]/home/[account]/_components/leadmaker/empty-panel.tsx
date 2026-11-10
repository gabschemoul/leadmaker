/**
 * Rôle : état vide « façon Apollo » (relooking du 8/11/2026) — panneau bleu pâle avec une icône
 * ronde, un titre, une phrase, un ou deux boutons, puis jusqu'à trois cartes qui expliquent la fonction.
 * Composant serveur, sans donnée : tout vient des props.
 */
import type { ReactNode } from 'react';

import { Card, CardContent } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

export function EmptyPanel(props: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  features?: { icon: ReactNode; title: ReactNode; text: ReactNode }[];
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-3xl flex-col gap-5',
        props.className,
      )}
      data-test={props.testId}
    >
      <div
        className={
          'from-brand-pale/80 to-brand-pale/20 flex flex-col items-center gap-3 rounded-2xl bg-linear-to-b px-6 py-12 text-center'
        }
      >
        <div
          className={
            'bg-card text-foreground ring-border flex size-12 items-center justify-center rounded-full ring-1 [&_svg]:size-5'
          }
        >
          {props.icon}
        </div>

        <h2 className={'font-heading mt-1 text-2xl font-medium tracking-tight'}>
          {props.title}
        </h2>

        <p className={'text-muted-foreground max-w-md text-sm'}>
          {props.description}
        </p>

        {props.actions ? (
          <div
            className={'mt-3 flex flex-wrap items-center justify-center gap-2'}
          >
            {props.actions}
          </div>
        ) : null}
      </div>

      {props.features?.length ? (
        <div className={'grid gap-3 sm:grid-cols-3'}>
          {props.features.map((feature, index) => (
            <Card key={index} size={'sm'}>
              <CardContent className={'flex flex-col gap-2'}>
                <div
                  className={
                    'bg-muted text-foreground flex size-8 items-center justify-center rounded-lg [&_svg]:size-4'
                  }
                >
                  {feature.icon}
                </div>

                <div className={'text-sm font-medium'}>{feature.title}</div>

                <p
                  className={
                    'text-muted-foreground text-[14px] leading-relaxed'
                  }
                >
                  {feature.text}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
