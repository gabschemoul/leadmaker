import { useRender } from '@base-ui/react/use-render';

import { cn } from '../../lib/utils';

export const HeroTitle: React.FC<
  React.HTMLAttributes<HTMLHeadingElement> & {
    render?: React.ReactElement;
  }
> = function HeroTitleComponent({ children, className, render, ...props }) {
  return useRender({
    render,
    defaultTagName: 'h1',
    props: {
      ...props,
      className: cn(
        'hero-title font-heading flex flex-col text-center text-4xl font-extrabold tracking-tighter sm:text-6xl lg:max-w-5xl lg:text-7xl xl:max-w-6xl dark:text-white',
        className,
      ),
      children,
    },
  });
};
