'use client';

import { useCallback, useState } from 'react';

import { Bell, CircleAlert, Info, TriangleAlert, XIcon } from 'lucide-react';
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
        <Bell className={'size-4 min-h-3 min-w-3'} />

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
