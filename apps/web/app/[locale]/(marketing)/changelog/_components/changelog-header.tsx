import Link from 'next/link';

import { ChevronLeft } from 'lucide-react';

import { Cms } from '@kit/cms';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { sanitizeCmsExcerptHtml } from '~/lib/sanitize-cms-html';

import { CoverImage } from '../../blog/_components/cover-image';
import { DateFormatter } from '../../blog/_components/date-formatter';

export async function ChangelogHeader({ entry }: { entry: Cms.ContentItem }) {
  const { title, publishedAt, description, image } = entry;
  const sanitizedDescription = description
    ? await sanitizeCmsExcerptHtml(description)
    : null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-border/50 border-b py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link
            href="/changelog"
            className="text-muted-foreground hover:text-primary flex items-center gap-1.5 text-sm font-medium transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <Trans i18nKey="marketing.changelog" />
          </Link>
        </div>
      </div>

      <div className={cn('border-border/50 border-b py-8')}>
        <div className="mx-auto flex max-w-3xl flex-col gap-y-2.5">
          <div>
            <span className="text-muted-foreground text-xs">
              <DateFormatter dateString={publishedAt} />
            </span>
          </div>

          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] xl:text-4xl dark:text-white">
            {title}
          </h1>

          {description && (
            <h2
              className="text-muted-foreground text-base"
              dangerouslySetInnerHTML={{ __html: sanitizedDescription ?? '' }}
            />
          )}
        </div>
      </div>

      <If condition={image}>
        {(imageUrl) => (
          <div className="relative mx-auto mt-8 flex h-[378px] w-full max-w-3xl justify-center">
            <CoverImage
              preloadImage
              className="rounded-md"
              title={title}
              src={imageUrl}
            />
          </div>
        )}
      </If>
    </div>
  );
}
