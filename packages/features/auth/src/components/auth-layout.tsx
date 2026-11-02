import { cn } from '@kit/ui/utils';

export function AuthLayoutShell({
  children,
  className,
  Logo,
  contentClassName,
}: React.PropsWithChildren<{
  Logo?: React.ComponentType;
  className?: string;
  contentClassName?: string;
}>) {
  return (
    <>
      <div
        className={cn(
          'animate-in fade-in slide-in-from-top-16 zoom-in-95 flex h-screen flex-col items-center justify-center gap-y-8 duration-1000',
          className,
        )}
      >
        <div
          className={cn(
            // DA façon ElevenLabs : champs hauts, boutons en pilule pleine largeur
            'bg-background flex w-full max-w-[23rem] flex-col gap-y-4 md:w-8/12 lg:w-5/12 xl:w-4/12',
            '[&_[data-slot=button]]:h-11 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:text-[0.9375rem] [&_[data-slot=button]]:font-normal [&_[data-slot=input-group]]:h-11 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input]]:h-11 [&_[data-slot=input]]:rounded-xl [&_[data-slot=input]]:px-3.5',
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>

      <div className="absolute top-8 left-0 flex w-full justify-center lg:top-7 lg:left-10 lg:w-auto">
        {Logo ? <Logo /> : null}
      </div>
    </>
  );
}
