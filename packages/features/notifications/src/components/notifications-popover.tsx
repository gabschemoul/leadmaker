'use client';

import { useCallback, useState } from 'react';

import { CircleAlert, Info, TriangleAlert, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { Separator } from '@kit/ui/separator';
import { cn } from '@kit/ui/utils';

import { useDismissNotification, useFetchNotifications } from '../hooks';
import { Notification } from '../types';

export function NotificationsPopover(params: {
  realtime: boolean;
  accountIds: string[];
  onClick?: (notification: Notification) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [now] = useState(() => new Date().getTime());

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const onNotifications = useCallback((notifications: Notification[]) => {
    setNotifications((existing) => {
      const unique = new Set(existing.map((notification) => notification.id));

      const notificationsFiltered = notifications.filter(
        (notification) => !unique.has(notification.id),
      );

      return [...notificationsFiltered, ...existing];
    });
  }, []);

  const dismissNotification = useDismissNotification();

  useFetchNotifications({
    onNotifications,
    accountIds: params.accountIds,
    realtime: params.realtime,
  });

  const timeAgo = (createdAt: string) => {
    const date = new Date(createdAt);

    let time: number;

    const daysAgo = Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24));

    const formatter = new Intl.RelativeTimeFormat(locale, {
      numeric: 'auto',
    });

    if (daysAgo < 1) {
      time = Math.floor((now - date.getTime()) / (1000 * 60));

      if (time < 5) {
        return t('common.justNow');
      }

      if (time < 60) {
        return formatter.format(-time, 'minute');
      }

      const hours = Math.floor(time / 60);

      return formatter.format(-hours, 'hour');
    }

    const unit = (() => {
      const minutesAgo = Math.floor((now - date.getTime()) / (1000 * 60));

      if (minutesAgo <= 60) {
        return 'minute';
      }

      if (daysAgo <= 1) {
        return 'hour';
      }

      if (daysAgo <= 30) {
        return 'day';
      }

      if (daysAgo <= 365) {
        return 'month';
      }

      return 'year';
    })();

    const text = formatter.format(-daysAgo, unit);

    return text.slice(0, 1).toUpperCase() + text.slice(1);
  };

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-test={'notifications-trigger'}
        render={<Button size="icon-lg" variant="ghost" className="relative" />}
      >
        {/* Prospectigo (10/11/2026) : cloche fournie par Gabriel, 20 px, trait de 1,5 px à l'écran */}
        <svg
          viewBox="0 0 18 18"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className={'size-5'}
        >
          <path
            d="M12.0001 12.938C12.0001 13.7337 11.684 14.4967 11.1214 15.0593C10.5588 15.622 9.79571 15.938 9.00006 15.938C8.20441 15.938 7.44135 15.622 6.87874 15.0593C6.31613 14.4967 6.00006 13.7337 6.00006 12.938M15.1881 12.183C15.1882 12.2822 15.1688 12.3804 15.1309 12.4721C15.093 12.5638 15.0374 12.647 14.9672 12.7172C14.8971 12.7873 14.8138 12.8429 14.7221 12.8808C14.6305 12.9187 14.5322 12.9382 14.4331 12.938H3.56706C3.4377 12.938 3.3105 12.9048 3.19771 12.8414C3.08492 12.778 2.99033 12.6867 2.92304 12.5762C2.85574 12.4658 2.818 12.3398 2.81345 12.2105C2.80891 12.0812 2.8377 11.953 2.89706 11.838L3.75006 10.182C3.89684 9.89711 3.98105 9.58412 3.99706 9.26402L4.12706 6.68202C4.19123 5.43372 4.73291 4.25787 5.64 3.39788C6.54708 2.53789 7.75011 2.0596 9.00006 2.06202C10.2498 2.05986 11.4526 2.53826 12.3595 3.39823C13.2664 4.25819 13.8079 5.43389 13.8721 6.68202L14.0021 9.26402C14.0191 9.58402 14.1031 9.89702 14.2501 10.182L15.1041 11.837C15.1591 11.9441 15.1879 12.0627 15.1881 12.183Z"
            stroke="currentColor"
            strokeWidth={1.35}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <span
          className={cn(
            `fade-in animate-in zoom-in absolute top-1 right-1 mt-0 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[0.6rem] text-white`,
            {
              hidden: !notifications.length,
            },
          )}
        >
          {notifications.length}
        </span>
      </PopoverTrigger>

      <PopoverContent
        data-test={'notifications-popover'}
        className={'flex w-full max-w-96 flex-col gap-0 lg:min-w-64'}
        align={'start'}
        sideOffset={10}
      >
        <div className={'flex items-center text-sm font-medium'}>
          {t('common.notifications')}
        </div>

        <Separator />

        <If condition={!notifications.length}>
          <div className={'text-sm'}>{t('common.noNotifications')}</div>
        </If>

        <div className={'flex max-h-[60vh] flex-col overflow-y-auto'}>
          {notifications.map((notification) => {
            const maxChars = 100;

            let body = t(notification.body, {
              defaultValue: notification.body,
            });

            if (body.length > maxChars) {
              body = body.substring(0, maxChars) + '...';
            }

            const Icon = () => {
              switch (notification.type) {
                case 'warning':
                  return <TriangleAlert className={'size-3 text-yellow-500'} />;
                case 'error':
                  return <CircleAlert className={'text-destructive size-3'} />;
                default:
                  return <Info className={'size-3 text-blue-500'} />;
              }
            };

            return (
              <div
                key={notification.id.toString()}
                data-test={'notification-item'}
                className={cn(
                  'flex min-h-14 flex-col items-start justify-center gap-y-1 px-1',
                )}
                onClick={() => {
                  if (params.onClick) {
                    params.onClick(notification);
                  }
                }}
              >
                <div className={'flex w-full items-start justify-between'}>
                  <div className={'flex items-start justify-start gap-x-1.5'}>
                    <div className={'flex flex-col'}>
                      <div className={'flex items-center gap-x-2 text-sm'}>
                        <Icon />

                        <If condition={notification.link} fallback={body}>
                          {(link) => (
                            <a href={link} className={'hover:underline'}>
                              {body}
                            </a>
                          )}
                        </If>
                      </div>

                      <span className={'text-muted-foreground text-xs'}>
                        {timeAgo(notification.created_at)}
                      </span>
                    </div>
                  </div>

                  <div className={'ml-2'}>
                    <Button
                      className={'max-h-6 max-w-6'}
                      size={'icon'}
                      variant={'ghost'}
                      onClick={() => {
                        setNotifications((existing) => {
                          return existing.filter(
                            (existingNotification) =>
                              existingNotification.id !== notification.id,
                          );
                        });

                        dismissNotification(notification.id).catch(
                          (error: unknown) => {
                            console.error(error);

                            // the dismiss did not persist: show it again
                            onNotifications([notification]);
                          },
                        );
                      }}
                    >
                      <XIcon className={'h-3'} />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
