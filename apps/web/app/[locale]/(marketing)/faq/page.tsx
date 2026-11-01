import Link from 'next/link';
import Script from 'next/script';

import { ArrowRight, ChevronDown } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button } from '@kit/ui/button';
import { Trans } from '@kit/ui/trans';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';

export const generateMetadata = async () => {
  const t = await getTranslations('marketing');

  return {
    title: t('faq'),
  };
};

async function FAQPage() {
  const t = await getTranslations('marketing');

  const faqItems = [1, 2, 3, 4, 5, 6].map((n) => ({
    question: t(`faqItems.q${n}`),
    answer: t(`faqItems.a${n}`),
  }));

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => {
      return {
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      };
    }),
  };

  return (
    <>
      <Script
        id={'faq:ld:json'}
        key={'ld:json'}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className={'flex flex-col space-y-4 xl:space-y-8'}>
        <SitePageHeader title={t('faq')} subtitle={t('faqSubtitle')} />

        <div
          className={
            'divide container flex flex-col items-center space-y-4 divide-y pb-16'
          }
        >
          <div className="flex w-full max-w-xl flex-col">
            {faqItems.map((item, index) => {
              return <FaqItem key={index} item={item} />;
            })}
          </div>

          <div className="flex w-full max-w-xl justify-start p-2">
            <Button
              nativeButton={false}
              render={<Link href={'/contact'} />}
              variant={'link'}
            >
              <span>
                <Trans i18nKey={'marketing.contactFaq'} />
              </span>

              <ArrowRight className={'w-4'} />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default FAQPage;

function FaqItem({
  item,
}: React.PropsWithChildren<{
  item: {
    question: string;
    answer: string;
  };
}>) {
  return (
    <details
      className={
        '[&:open]:bg-muted/50 border-dashed transition-all [&:open]:scale-[1.05]'
      }
    >
      <summary
        className={'group/faq-item flex items-center justify-between p-4'}
      >
        <h2
          className={
            'cursor-pointer font-sans text-base group-hover/faq-item:underline'
          }
        >
          {item.question}
        </h2>

        <div>
          <ChevronDown
            className={'h-5 transition duration-300 group-open:-rotate-180'}
          />
        </div>
      </summary>

      <div className={'text-muted-foreground flex flex-col gap-y-2 px-4 pb-2'}>
        {item.answer}
      </div>
    </details>
  );
}
