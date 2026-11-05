import { getLocale, getTranslations } from 'next-intl/server';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';

import { type LegalDocumentId, getLegalDocument } from '../_lib/legal-content';

/**
 * Page légale (CGU, confidentialité, cookies, mentions légales) : titre traduit + texte de
 * `_lib/legal-content.ts` dans la langue du visiteur.
 */
export async function LegalPage(props: {
  id: LegalDocumentId;
  titleKey: string;
  subtitleKey: string;
}) {
  const t = await getTranslations('marketing');
  const locale = await getLocale();
  const { document, updatedAt, lang } = getLegalDocument(props.id, locale);

  return (
    <div>
      <SitePageHeader
        title={t(props.titleKey)}
        subtitle={t(props.subtitleKey)}
      />

      <article className={'container mx-auto max-w-3xl py-8'}>
        <p className={'text-muted-foreground mb-8 text-sm'}>
          {lang === 'fr' ? 'Dernière mise à jour : ' : 'Last updated: '}
          {updatedAt}
        </p>

        {document.intro ? (
          <p className={'mb-8 leading-relaxed'}>{document.intro}</p>
        ) : null}

        <div className={'flex flex-col gap-y-8'}>
          {document.sections.map((section) => (
            <section key={section.title} className={'flex flex-col gap-y-3'}>
              <h2 className={'text-xl font-medium'}>{section.title}</h2>

              {section.paragraphs.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  className={'text-muted-foreground leading-relaxed'}
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
