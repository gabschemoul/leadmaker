import Script from 'next/script';

import { ArrowRight, ChevronDown } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Trans } from '@kit/ui/trans';

import {
  Band,
  BandBody,
  DisplayTitle,
  PillLink,
} from '~/(marketing)/_components/el';
import { SitePageHeader } from '~/(marketing)/_components/site-page-header';

export const generateMetadata = async () => {
  const t = await getTranslations('marketing');

  return {
    title: t('faq'),
  };
};

async function FAQPage() {
  const t = await getTranslations('marketing');

  const faqItems = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
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

      <div className={'flex flex-col'}>
        <SitePageHeader title={t('faq')} subtitle={t('faqSubtitle')} />

        <Band>
          <BandBody>
            <div className={'grid gap-x-12 gap-y-8 md:grid-cols-[1fr_1.6fr]'}>
              <DisplayTitle size={'section'}>{t('faqTitleShort')}</DisplayTitle>

              <div className={'flex flex-col'}>
                {faqItems.map((item, index) => {
                  return <FaqItem key={index} item={item} />;
                })}

                <div className={'pt-8'}>
                  <PillLink href={'/contact'} variant={'secondary'} size={'md'}>
                    <Trans i18nKey={'marketing.contactFaq'} />
                    <ArrowRight />
                  </PillLink>
                </div>
              </div>
            </div>
          </BandBody>
        </Band>
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
        'group/faq-item bg-[linear-gradient(to_right,var(--stone-300)_50%,transparent_0)] bg-[length:5px_1px] bg-bottom bg-repeat-x dark:bg-[linear-gradient(to_right,var(--stone-700)_50%,transparent_0)]'
      }
    >
      <summary
        className={
          'flex cursor-pointer list-none items-center justify-between gap-x-4 py-5 [&::-webkit-details-marker]:hidden'
        }
      >
        <h2
          className={'font-sans text-[1.0625rem] font-normal tracking-[0.01em]'}
        >
          {item.question}
        </h2>

        <ChevronDown
          className={
            'text-muted-foreground size-4 shrink-0 transition duration-300 group-open/faq-item:-rotate-180'
          }
        />
      </summary>

      <div
        className={
          'text-muted-foreground pb-5 text-[0.9375rem] leading-[1.55] tracking-[0.01em]'
        }
      >
        {item.answer}
      </div>
    </details>
  );
}
