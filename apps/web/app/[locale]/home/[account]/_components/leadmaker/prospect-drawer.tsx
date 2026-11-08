'use client';

/**
 * Rôle : fiche d'un prospect dans un tiroir à droite (relooking du 8/11/2026, façon Apollo) :
 * identité, pastilles, actions, coordonnées. Le tableau reste visible derrière.
 * Données : ProspectRow passé par le tableau. Écritures : aucune.
 */
import Link from 'next/link';

import { ExternalLink, Phone, Star } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Button } from '@kit/ui/button';
import { Separator } from '@kit/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@kit/ui/sheet';
import { Trans } from '@kit/ui/trans';

import { LocalDateTime } from '~/components/local-date-time';
import { websiteHref, websiteLabel } from '~/lib/leadmaker/website';

import type { ProspectRow } from './prospects-table';

export function ProspectDrawer(props: {
  prospect: ProspectRow | null;
  campaignsPath?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('prospects');
  const format = useFormatter();
  const { prospect } = props;

  const siteHref = prospect ? websiteHref(prospect.website) : null;

  return (
    <Sheet open={prospect !== null} onOpenChange={props.onOpenChange}>
      <SheetContent
        className={'w-full gap-0 overflow-y-auto sm:max-w-[640px]'}
        data-test={'prospect-drawer'}
      >
        {prospect ? (
          <>
            <SheetHeader className={'gap-3 p-6 pb-5'}>
              <div className={'flex items-start gap-3 pr-8'}>
                <div
                  className={
                    'bg-muted flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium'
                  }
                >
                  {initials(prospect.name)}
                </div>

                <div className={'flex min-w-0 flex-col gap-1'}>
                  <SheetTitle className={'text-lg leading-tight'}>
                    {prospect.name}
                  </SheetTitle>

                  <SheetDescription>
                    {[prospect.category, prospect.city]
                      .filter(Boolean)
                      .join(' · ') || '–'}
                  </SheetDescription>

                  <div className={'mt-1 flex flex-wrap items-center gap-1.5'}>
                    {prospect.rating !== null ? (
                      <Badge variant={'outline'}>
                        <Star />
                        {format.number(prospect.rating, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                        {prospect.review_count !== null
                          ? ` · ${format.number(prospect.review_count)} ${t('columns.reviews').toLocaleLowerCase()}`
                          : null}
                      </Badge>
                    ) : null}

                    <Badge variant={'secondary'}>
                      <Trans i18nKey={`prospects.source.${prospect.source}`} />
                    </Badge>

                    {prospect.is_chain ? (
                      <Badge variant={'outline'}>
                        <Trans i18nKey={'prospects.chainBadge'} />
                      </Badge>
                    ) : null}

                    {prospect.excluded_at ? (
                      <Badge
                        variant={'secondary'}
                        className={badgeExtras.warning}
                      >
                        <Trans i18nKey={'prospects.excludedBadge'} />
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={'flex flex-wrap gap-2'}>
                {siteHref ? (
                  <Button
                    size={'sm'}
                    variant={'outline'}
                    nativeButton={false}
                    render={
                      <a
                        href={siteHref}
                        target={'_blank'}
                        rel={'noopener noreferrer nofollow'}
                      />
                    }
                  >
                    <ExternalLink />
                    {t('drawer.site')}
                  </Button>
                ) : null}

                {prospect.phone ? (
                  <Button
                    size={'sm'}
                    variant={'outline'}
                    nativeButton={false}
                    render={<a href={`tel:${prospect.phone}`} />}
                  >
                    <Phone />
                    {prospect.phone}
                  </Button>
                ) : null}
              </div>
            </SheetHeader>

            <Separator />

            <dl
              className={
                'grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-3 p-6 text-sm'
              }
            >
              <Field label={t('columns.phone')} value={prospect.phone} />

              <Field
                label={t('columns.website')}
                value={
                  prospect.website
                    ? websiteLabel(prospect.website, { keepPath: true })
                    : null
                }
              />

              <Field label={t('columns.email')} value={prospect.found_email} />

              <Field label={t('columns.address')} value={prospect.address} />

              <dt className={'text-muted-foreground'}>
                {t('columns.campaign')}
              </dt>
              <dd className={'min-w-0 truncate'}>
                {prospect.campaign ? (
                  props.campaignsPath ? (
                    <Link
                      className={'underline-offset-4 hover:underline'}
                      href={`${props.campaignsPath}/${prospect.campaign.id}`}
                    >
                      {prospect.campaign.name}
                    </Link>
                  ) : (
                    prospect.campaign.name
                  )
                ) : (
                  '–'
                )}
              </dd>

              <dt className={'text-muted-foreground'}>{t('columns.date')}</dt>
              <dd>
                <LocalDateTime
                  value={prospect.created_at}
                  dateStyle={'medium'}
                />
              </dd>
            </dl>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field(props: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className={'text-muted-foreground'}>{props.label}</dt>
      <dd className={'min-w-0 break-words'}>{props.value || '–'}</dd>
    </>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}
