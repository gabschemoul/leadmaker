import {
  RadioGroup,
  RadioGroupItem as ShadcnRadioGroupItem,
} from '../shadcn/radio-group';

import { cn } from '#lib/utils';

/** Prospectigo (8/11/2026) — bouton radio bleu Klein quand il est choisi (charte du site). */
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnRadioGroupItem>) {
  return (
    <ShadcnRadioGroupItem
      className={cn(
        'data-checked:border-brand data-checked:bg-brand data-checked:text-brand-foreground dark:data-checked:bg-brand',
        className,
      )}
      {...props}
    />
  );
}

function RadioGroupItemLabel({
  selected,
  className,
  children,
  ...props
}: React.PropsWithChildren<{
  selected?: boolean;
}> &
  React.LabelHTMLAttributes<unknown>) {
  return (
    <label
      data-selected={selected}
      className={cn(
        className,
        'flex cursor-pointer rounded-[10px]' +
          ' border-border items-center space-x-4 border' +
          ' focus-within:border-brand active:bg-muted p-2.5 text-sm transition-all',
        {
          [`bg-muted/70`]: selected,
          [`hover:bg-muted/50`]: !selected,
        },
      )}
      {...props}
    >
      {children}
    </label>
  );
}

export { RadioGroup, RadioGroupItem, RadioGroupItemLabel };
