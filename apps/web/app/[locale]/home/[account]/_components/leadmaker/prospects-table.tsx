import { ExternalLink } from 'lucide-react';
import { useFormatter } from 'next-intl';

import { Badge } from '@kit/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Trans } from '@kit/ui/trans';

export interface ProspectRow {
  id: string;
  name: string;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  is_chain: boolean;
  source?: 'maps' | 'csv';
}

function websiteHref(website: string) {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function websiteLabel(website: string) {
  return website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

/** Tableau de prospects, partagé entre le détail d'une campagne et la page Prospects. */
export function ProspectsTable(props: {
  prospects: ProspectRow[];
  showSource?: boolean;
}) {
  const format = useFormatter();

  return (
    <div className={'overflow-x-auto'}>
      <Table data-test={'prospects-table'}>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Trans i18nKey={'campaigns.prospects.nameColumn'} />
            </TableHead>

            <TableHead>
              <Trans i18nKey={'campaigns.prospects.categoryColumn'} />
            </TableHead>

            <TableHead className={'text-right'}>
              <Trans i18nKey={'campaigns.prospects.ratingColumn'} />
            </TableHead>

            <TableHead className={'text-right'}>
              <Trans i18nKey={'campaigns.prospects.reviewsColumn'} />
            </TableHead>

            <TableHead>
              <Trans i18nKey={'campaigns.prospects.addressColumn'} />
            </TableHead>

            <TableHead>
              <Trans i18nKey={'campaigns.prospects.websiteColumn'} />
            </TableHead>

            <TableHead>
              <Trans i18nKey={'campaigns.prospects.phoneColumn'} />
            </TableHead>

            {props.showSource ? (
              <TableHead>
                <Trans i18nKey={'campaigns.prospects.sourceColumn'} />
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>

        <TableBody>
          {props.prospects.map((prospect) => (
            <TableRow key={prospect.id} data-test={'prospect-row'}>
              <TableCell className={'font-medium'}>
                <span className={'flex items-center gap-2'}>
                  <span>{prospect.name}</span>

                  {prospect.is_chain ? (
                    <Badge
                      variant={'outline'}
                      data-test={'prospect-chain-badge'}
                    >
                      <Trans i18nKey={'campaigns.prospects.chainBadge'} />
                    </Badge>
                  ) : null}
                </span>
              </TableCell>

              <TableCell className={'text-muted-foreground'}>
                {prospect.category ?? '–'}
              </TableCell>

              <TableCell className={'text-right tabular-nums'}>
                {prospect.rating === null
                  ? '–'
                  : format.number(prospect.rating, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
              </TableCell>

              <TableCell className={'text-right tabular-nums'}>
                {prospect.review_count === null
                  ? '–'
                  : format.number(prospect.review_count)}
              </TableCell>

              <TableCell
                className={'max-w-64 truncate'}
                title={prospect.address ?? ''}
              >
                {prospect.address ?? '–'}
              </TableCell>

              <TableCell>
                {prospect.website ? (
                  <a
                    className={'inline-flex items-center gap-1 hover:underline'}
                    href={websiteHref(prospect.website)}
                    target={'_blank'}
                    rel={'noopener noreferrer nofollow'}
                  >
                    <span className={'max-w-48 truncate'}>
                      {websiteLabel(prospect.website)}
                    </span>

                    <ExternalLink className={'size-3 shrink-0'} />
                  </a>
                ) : (
                  '–'
                )}
              </TableCell>

              <TableCell className={'whitespace-nowrap'}>
                {prospect.phone ?? '–'}
              </TableCell>

              {props.showSource ? (
                <TableCell>
                  <Badge variant={'secondary'}>
                    <Trans
                      i18nKey={`campaigns.prospects.source.${prospect.source ?? 'maps'}`}
                    />
                  </Badge>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
