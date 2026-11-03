import { Cms } from '@kit/cms';
import { If } from '@kit/ui/if';
import { cn } from '@kit/ui/utils';

import { sanitizeCmsExcerptHtml } from '~/lib/sanitize-cms-html';

import { CoverImage } from './cover-image';
import { DateFormatter } from './date-formatter';

export async function PostHeader({ post }: { post: Cms.ContentItem }) {
  const { title, publishedAt, description, image } = post;
  const sanitizedDescription = description
    ? await sanitizeCmsExcerptHtml(description)
    : null;

  return (
    <div className={'flex flex-1 flex-col'}>
      <div className={cn('border-border/50 border-b py-8')}>
        <div className={'mx-auto flex max-w-3xl flex-col gap-y-2.5'}>
          <div>
            <span className={'text-muted-foreground text-xs'}>
              <DateFormatter dateString={publishedAt} />
            </span>
          </div>

          <h1
            className={
              'font-display text-2xl font-medium tracking-[-0.01em] xl:text-4xl dark:text-white'
            }
          >
            {title}
          </h1>

          <h2
            className={'text-muted-foreground text-base'}
            dangerouslySetInnerHTML={{ __html: sanitizedDescription ?? '' }}
          ></h2>
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
