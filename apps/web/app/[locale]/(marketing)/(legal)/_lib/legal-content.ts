/**
 * Textes des pages légales de prospectigo.com (FR / EN).
 *
 * Rédigés le 5/11/2026 à partir des mentions légales de studionamma.com (éditeur NAAMA LTD, directeur de la
 * publication Gabriel Schemoul). Ce sont des textes de bonne foi, PAS un avis juridique : à faire relire par
 * un juriste avant d'accueillir des clients à grande échelle. Pour modifier une info de l'éditeur, changer
 * uniquement `PUBLISHER` ci-dessous.
 */

export const PUBLISHER = {
  company: 'NAAMA LTD',
  registration: '51-843-2974',
  brand: 'Prospectigo',
  director: 'Gabriel Schemoul',
  email: 'hello@studionamma.com',
  updatedAt: { fr: '9 novembre 2026', en: 'November 9, 2026' },
};

export type LegalSection = { title: string; paragraphs: string[] };
export type LegalDocument = { intro?: string; sections: LegalSection[] };
export type LegalLocale = 'fr' | 'en';
export type LegalDocumentId = 'terms' | 'privacy' | 'cookies' | 'notice';

const P = PUBLISHER;

const fr: Record<LegalDocumentId, LegalDocument> = {
  notice: {
    sections: [
      {
        title: 'Éditeur',
        paragraphs: [
          `Le site prospectigo.com et l'application ${P.brand} sont édités par ${P.company}, société immatriculée sous le numéro ${P.registration}, opérant sous la marque Studio Namma (Paris, France).`,
          `Directeur de la publication : ${P.director}.`,
          `Contact : ${P.email}.`,
        ],
      },
      {
        title: 'Hébergement',
        paragraphs: [
          'Site et application : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis.',
          'Base de données et authentification : Supabase Inc.',
        ],
      },
      {
        title: 'Propriété intellectuelle',
        paragraphs: [
          `La marque ${P.brand}, le site, l'application, leurs textes, visuels et logiciels sont la propriété de ${P.company}. Toute reproduction sans autorisation écrite est interdite.`,
        ],
      },
    ],
  },
  terms: {
    intro: `Les présentes conditions encadrent l'utilisation de ${P.brand} par ses clients professionnels. En créant un compte ou en souscrivant un forfait, vous les acceptez.`,
    sections: [
      {
        title: '1. Le service',
        paragraphs: [
          `${P.brand} aide les professionnels à trouver des entreprises qui correspondent à une zone géographique, à des secteurs d'activité et à des critères (note moyenne, présence d'un site web…), puis à leur transmettre un message par le formulaire de contact de leur site, automatiquement ou après validation.`,
          `${P.brand} est réservé aux professionnels (entreprises, indépendants, agences) agissant pour leur activité.`,
        ],
      },
      {
        title: '2. Compte et accès',
        paragraphs: [
          "Vous êtes responsable de l'exactitude des informations de votre compte, de la confidentialité de vos identifiants et de toutes les actions faites depuis votre compte et votre équipe.",
          "Le nombre de membres de l'équipe, de dossiers clients et de campagnes actives dépend de votre forfait.",
        ],
      },
      {
        title: '3. Forfaits, crédits et paiement',
        paragraphs: [
          'Les forfaits sont facturés en dollars américains, par mois ou par an, via notre prestataire de paiement Stripe. Le prix applicable est celui affiché sur la page Tarifs au moment de la souscription.',
          'Chaque forfait donne droit chaque mois à un nombre de crédits. Des crédits sont consommés pour chaque entreprise gardée (1, 2 ou 4 crédits selon la difficulté de la recherche, mesurée automatiquement) ; la prise de contact de ces entreprises est incluse et ne consomme aucun crédit. Les crédits non utilisés ne sont pas reportés sur la période suivante.',
          "L'abonnement se renouvelle automatiquement. Vous pouvez le résilier à tout moment depuis la page Facturation : il reste actif jusqu'à la fin de la période payée, sans remboursement de la période en cours, sauf obligation légale contraire.",
          'Un changement de forfait en cours de période est facturé au prorata par Stripe ; vos crédits sont ajustés en conséquence.',
        ],
      },
      {
        title: '4. Utilisation acceptable : vos obligations',
        paragraphs: [
          "Vous êtes seul responsable du contenu des messages que vous faites envoyer et du respect des lois qui s'appliquent à votre prospection, notamment dans les pays des entreprises contactées (par exemple le RGPD et les règles sur la prospection en Europe, le CAN-SPAM Act aux États-Unis).",
          "Vous vous engagez notamment à : vous identifier clairement dans vos messages (nom de votre entreprise et moyen de vous répondre) ; ne pas envoyer de contenu trompeur, illicite, diffamatoire, harcelant ou contraire aux bonnes mœurs ; respecter immédiatement toute demande d'une entreprise de ne plus être contactée, en l'ajoutant à votre liste « Ne jamais contacter ».",
          `${P.company} peut suspendre ou résilier sans préavis un compte qui ne respecte pas ces règles ou qui expose ${P.brand} ou des tiers à un risque juridique.`,
        ],
      },
      {
        title: '5. Données des entreprises prospectées',
        paragraphs: [
          'Les informations sur les entreprises (nom, activité, adresse, téléphone, site web, note moyenne…) sont des informations professionnelles rendues publiques par ces entreprises. Pour votre prospection, vous agissez en tant que responsable du traitement de ces données ; ' +
            `${P.company} les traite pour votre compte, selon vos instructions.`,
          `Toute entreprise peut demander à ne plus être contactée via ${P.brand} en écrivant à ${P.email} : son site est alors ajouté à une liste d'opposition appliquée à tous les clients.`,
        ],
      },
      {
        title: '6. Disponibilité et responsabilité',
        paragraphs: [
          `${P.company} fait ses meilleurs efforts pour assurer la disponibilité et le bon fonctionnement du service, sans garantie d'un résultat commercial (nombre de prospects, de réponses ou de ventes). Certains formulaires ne peuvent pas être remplis automatiquement (protection anti-robot, site indisponible…).`,
          `Dans la limite permise par la loi, la responsabilité de ${P.company} est limitée aux sommes que vous avez payées au cours des douze derniers mois, et exclut les dommages indirects (perte de chiffre d'affaires, d'image ou de données).`,
        ],
      },
      {
        title: '7. Modifications et contact',
        paragraphs: [
          'Ces conditions peuvent évoluer ; la version en vigueur est toujours publiée sur cette page, avec sa date. En cas de changement important, nous vous prévenons par e-mail.',
          `Pour toute question : ${P.email}.`,
        ],
      },
    ],
  },
  privacy: {
    intro: `Cette politique explique quelles données ${P.company} (« nous ») traite quand vous utilisez prospectigo.com et l'application ${P.brand}, et quels sont vos droits.`,
    sections: [
      {
        title: '1. Responsable du traitement',
        paragraphs: [
          `${P.company}, immatriculée sous le numéro ${P.registration}. Contact pour toute question sur vos données : ${P.email}.`,
        ],
      },
      {
        title: '2. Données de nos clients',
        paragraphs: [
          'Compte : nom, adresse e-mail, mot de passe (chiffré), équipe et rôle. Expéditeur : les coordonnées professionnelles que vous saisissez pour remplir les formulaires (nom, entreprise, e-mail, téléphone, adresse). Facturation : gérée par Stripe ; nous ne voyons jamais votre numéro de carte. Utilisation : campagnes, messages, journaux techniques nécessaires à la sécurité et au bon fonctionnement.',
          "Ces données servent à fournir le service, facturer, vous envoyer les e-mails nécessaires (connexion, invitations, alertes) et sécuriser l'application. Base légale : l'exécution du contrat et notre intérêt légitime à sécuriser le service.",
        ],
      },
      {
        title: '3. Données des entreprises contactées',
        paragraphs: [
          'Nous traitons, pour le compte de nos clients, des informations professionnelles publiques sur des entreprises (nom, activité, adresse, téléphone, site web, adresse e-mail de contact affichée sur leur site, note moyenne). Elles servent uniquement à la prospection du client qui a lancé la recherche.',
          `Une entreprise peut à tout moment demander l'accès à ces informations, leur suppression ou ne plus être contactée, en écrivant à ${P.email}. Son site est alors placé sur une liste d'opposition appliquée à tous les clients.`,
        ],
      },
      {
        title: '4. Prestataires',
        paragraphs: [
          'Nous faisons appel à des prestataires qui traitent des données pour notre compte : Vercel (hébergement du site), Supabase (base de données et connexion), Stripe (paiements), Resend (envoi des e-mails). Certains sont situés aux États-Unis ; les transferts sont encadrés par les garanties prévues par la réglementation (clauses contractuelles types, cadre de protection des données UE–États-Unis).',
          'Nous ne vendons aucune donnée personnelle.',
        ],
      },
      {
        title: '5. Durée de conservation',
        paragraphs: [
          "Les données de compte sont conservées tant que le compte est actif, puis supprimées dans un délai raisonnable après sa fermeture, sauf obligations légales (par exemple comptables). Les prospects et campagnes sont supprimés avec l'équipe qui les a créés.",
        ],
      },
      {
        title: '6. Vos droits',
        paragraphs: [
          `Vous pouvez demander l'accès à vos données, leur rectification, leur suppression, leur portabilité, ou vous opposer à un traitement, en écrivant à ${P.email}. Vous pouvez aussi saisir l'autorité de protection des données de votre pays (en France, la CNIL).`,
        ],
      },
      {
        title: '7. Sécurité',
        paragraphs: [
          "Les données sont chiffrées en transit, l'accès est cloisonné par équipe et protégé par mot de passe (double authentification disponible). Les accès internes sont limités aux personnes qui en ont besoin.",
        ],
      },
    ],
  },
  cookies: {
    intro: `${P.brand} n'utilise que les cookies nécessaires à son fonctionnement. Aucun cookie publicitaire ni de mesure d'audience tierce n'est déposé.`,
    sections: [
      {
        title: 'Cookies utilisés',
        paragraphs: [
          'Connexion : garder votre session ouverte et sécurisée. Préférences : langue, thème clair ou sombre, état de la barre latérale. Paiement : Stripe peut déposer ses propres cookies sur ses pages de paiement, pour la prévention de la fraude.',
        ],
      },
      {
        title: 'Votre choix',
        paragraphs: [
          'Ces cookies étant indispensables, ils ne demandent pas de consentement. Vous pouvez les supprimer depuis votre navigateur ; vous serez alors déconnecté et vos préférences seront réinitialisées.',
        ],
      },
    ],
  },
};

const en: Record<LegalDocumentId, LegalDocument> = {
  notice: {
    sections: [
      {
        title: 'Publisher',
        paragraphs: [
          `The prospectigo.com website and the ${P.brand} application are published by ${P.company}, a company registered under number ${P.registration}, operating under the Studio Namma brand (Paris, France).`,
          `Publication director: ${P.director}.`,
          `Contact: ${P.email}.`,
        ],
      },
      {
        title: 'Hosting',
        paragraphs: [
          'Website and application: Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA.',
          'Database and authentication: Supabase Inc.',
        ],
      },
      {
        title: 'Intellectual property',
        paragraphs: [
          `The ${P.brand} brand, website, application, texts, visuals and software belong to ${P.company}. Any reproduction without written permission is prohibited.`,
        ],
      },
    ],
  },
  terms: {
    intro: `These terms govern the use of ${P.brand} by its business customers. By creating an account or subscribing to a plan, you accept them.`,
    sections: [
      {
        title: '1. The service',
        paragraphs: [
          `${P.brand} helps businesses find companies matching a geographic area, industries and criteria (average rating, website…), then deliver a message through the contact form on their website, automatically or after approval.`,
          `${P.brand} is reserved for professionals (companies, freelancers, agencies) acting for their business.`,
        ],
      },
      {
        title: '2. Account and access',
        paragraphs: [
          'You are responsible for the accuracy of your account information, the confidentiality of your credentials and all actions taken from your account and team.',
          'The number of team members, client folders and active campaigns depends on your plan.',
        ],
      },
      {
        title: '3. Plans, credits and payment',
        paragraphs: [
          'Plans are billed in US dollars, monthly or yearly, through our payment provider Stripe. The applicable price is the one shown on the Pricing page when you subscribe.',
          'Each plan grants a number of credits every month. Credits are used for each business kept (1, 2 or 4 credits depending on how hard the search is, measured automatically); contacting these businesses is included and uses no credits. Unused credits do not roll over to the next period.',
          'Subscriptions renew automatically. You can cancel at any time from the Billing page: it stays active until the end of the paid period, with no refund for the current period unless the law requires otherwise.',
          'A plan change during a period is prorated by Stripe; your credits are adjusted accordingly.',
        ],
      },
      {
        title: '4. Acceptable use: your obligations',
        paragraphs: [
          'You are solely responsible for the content of the messages you send and for complying with the laws that apply to your outreach, including in the countries of the businesses you contact (for example the GDPR and e-marketing rules in Europe, the CAN-SPAM Act in the United States).',
          'In particular, you agree to: clearly identify yourself in your messages (your company name and a way to reply); not send misleading, unlawful, defamatory or harassing content; immediately honour any request from a business to stop contacting it, by adding it to your “Never contact” list.',
          `${P.company} may suspend or terminate without notice any account that breaks these rules or exposes ${P.brand} or third parties to legal risk.`,
        ],
      },
      {
        title: '5. Data about prospected businesses',
        paragraphs: [
          `Business information (name, industry, address, phone, website, average rating…) is professional information made public by those businesses. For your outreach, you act as the data controller; ${P.company} processes this data on your behalf and on your instructions.`,
          `Any business can ask to no longer be contacted through ${P.brand} by writing to ${P.email}: its website is then added to an opt-out list applied to all customers.`,
        ],
      },
      {
        title: '6. Availability and liability',
        paragraphs: [
          `${P.company} uses its best efforts to keep the service available and working, without guaranteeing any business result (number of prospects, replies or sales). Some forms cannot be filled automatically (anti-bot protection, website down…).`,
          `To the extent permitted by law, ${P.company}'s liability is limited to the amounts you paid in the last twelve months and excludes indirect damages (loss of revenue, reputation or data).`,
        ],
      },
      {
        title: '7. Changes and contact',
        paragraphs: [
          'These terms may change; the current version is always published on this page with its date. We will email you about any significant change.',
          `Questions: ${P.email}.`,
        ],
      },
    ],
  },
  privacy: {
    intro: `This policy explains what data ${P.company} (“we”) processes when you use prospectigo.com and the ${P.brand} application, and what your rights are.`,
    sections: [
      {
        title: '1. Data controller',
        paragraphs: [
          `${P.company}, registered under number ${P.registration}. Contact for any question about your data: ${P.email}.`,
        ],
      },
      {
        title: '2. Customer data',
        paragraphs: [
          'Account: name, email address, password (encrypted), team and role. Sender: the business contact details you enter to fill in forms (name, company, email, phone, address). Billing: handled by Stripe; we never see your card number. Usage: campaigns, messages, technical logs needed for security and operation.',
          'This data is used to provide the service, bill you, send necessary emails (sign-in, invitations, alerts) and secure the application. Legal basis: performance of the contract and our legitimate interest in securing the service.',
        ],
      },
      {
        title: '3. Data about contacted businesses',
        paragraphs: [
          'On behalf of our customers, we process public professional information about businesses (name, industry, address, phone, website, contact email shown on their website, average rating). It is used only for the outreach of the customer who ran the search.',
          `A business can at any time ask to access this information, have it deleted or stop being contacted, by writing to ${P.email}. Its website is then placed on an opt-out list applied to all customers.`,
        ],
      },
      {
        title: '4. Service providers',
        paragraphs: [
          'We use providers that process data on our behalf: Vercel (website hosting), Supabase (database and sign-in), Stripe (payments), Resend (email delivery). Some are located in the United States; transfers rely on the safeguards provided by law (standard contractual clauses, EU–US Data Privacy Framework).',
          'We never sell personal data.',
        ],
      },
      {
        title: '5. Retention',
        paragraphs: [
          'Account data is kept while the account is active, then deleted within a reasonable time after it is closed, except where the law requires otherwise (for example accounting). Prospects and campaigns are deleted with the team that created them.',
        ],
      },
      {
        title: '6. Your rights',
        paragraphs: [
          `You can request access, correction, deletion or portability of your data, or object to processing, by writing to ${P.email}. You can also contact the data protection authority of your country.`,
        ],
      },
      {
        title: '7. Security',
        paragraphs: [
          'Data is encrypted in transit, access is isolated per team and protected by password (two-factor authentication available). Internal access is limited to the people who need it.',
        ],
      },
    ],
  },
  cookies: {
    intro: `${P.brand} only uses the cookies it needs to work. No advertising or third-party analytics cookies are set.`,
    sections: [
      {
        title: 'Cookies we use',
        paragraphs: [
          'Sign-in: keep your session open and secure. Preferences: language, light or dark theme, sidebar state. Payment: Stripe may set its own cookies on its payment pages, for fraud prevention.',
        ],
      },
      {
        title: 'Your choice',
        paragraphs: [
          'As these cookies are essential, they do not require consent. You can delete them from your browser; you will then be signed out and your preferences reset.',
        ],
      },
    ],
  },
};

export function getLegalDocument(id: LegalDocumentId, locale: string) {
  const lang: LegalLocale = locale.startsWith('fr') ? 'fr' : 'en';

  return {
    document: (lang === 'fr' ? fr : en)[id],
    updatedAt: PUBLISHER.updatedAt[lang],
    lang,
  };
}
