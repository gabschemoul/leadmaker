/**
 * Rôle : bande de chiffres clés, relevée le 10/11/2026 sur les pages de chiffres d'ElevenLabs (Usage) : des
 * tuiles côte à côte séparées par un filet, chacune avec un libellé gris de 13 px et un chiffre de 18 px.
 * Une tuile peut être un lien (petite flèche ↗) ou un onglet (`active` + `onClick`) : l'onglet actif est blanc
 * et souligné de noir, les autres légèrement grisés, comme chez ElevenLabs.
 * Utilisé par les étapes Envoi et Résultats d'une campagne. Écritures : aucune.
 */
import Link from 'next/link';

import { ArrowUpRight } from 'lucide-react';

import { cn } from '@kit/ui/utils';

export function KpiStrip(props: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-border grid grid-cols-2 gap-px sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none',
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function Kpi(props: {
  label: string;
  value: React.ReactNode;
  /** lien : la tuile entière mène à cette page */
  href?: string;
  /** onglet : la tuile choisit ce qui est affiché dessous */
  onClick?: () => void;
  active?: boolean;
  testId?: string;
}) {
  const tab = props.onClick !== undefined;

  const content = (
    <>
      <span
        className={cn(
          'flex items-center gap-1 text-[13px] font-medium',
          tab && props.active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {props.label}
        {props.href ? <ArrowUpRight className={'size-3.5'} /> : null}
      </span>

      <span
        className={
          'text-foreground text-[18px] leading-[26px] font-medium tabular-nums'
        }
        data-test={props.testId}
      >
        {props.value}
      </span>
    </>
  );

  const base = 'flex flex-col items-start gap-0.5 p-4 text-left';
  const hover =
    'transition-colors duration-75 hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_2%)]';

  if (tab) {
    return (
      <button
        type={'button'}
        aria-pressed={props.active}
        onClick={props.onClick}
        className={cn(
          base,
          'border-b-[1.5px]',
          props.active
            ? 'bg-card border-foreground'
            : cn(
                'border-transparent bg-[color-mix(in_oklab,var(--card),var(--foreground)_2%)]',
                'transition-colors duration-75 hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_4%)]',
              ),
        )}
      >
        {content}
      </button>
    );
  }

  if (props.href) {
    return (
      <Link href={props.href} className={cn(base, 'bg-card', hover)}>
        {content}
      </Link>
    );
  }

  return <div className={cn(base, 'bg-card')}>{content}</div>;
}
