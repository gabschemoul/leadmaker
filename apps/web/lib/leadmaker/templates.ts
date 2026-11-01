/**
 * Modèles de messages d'une campagne : jusqu'à quatre messages (objet + texte)
 * tirés en rotation équilibrée. Chaque message a sa propre version courte
 * (facultative) pour les sites qui limitent la longueur. Stockés dans la colonne jsonb `templates` de
 * lm_campaigns ; le worker Python applique les mêmes variables.
 */

export const MAX_MESSAGES = 4;
export const SHORT_BODY_MAX = 200;
export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

export interface MessageTemplate {
  name: string;
  subject: string;
  body: string;
  /** version courte du message (200 caractères au plus), facultative */
  short: string;
}

export interface CampaignTemplates {
  messages: MessageTemplate[];
}

/** Variables disponibles ; les alias français du prototype restent acceptés. */
export const TEMPLATE_VARIABLES = [
  { token: 'company', aliases: ['entreprise'], group: 'prospect' },
  { token: 'city', aliases: ['ville'], group: 'prospect' },
  { token: 'category', aliases: ['categorie'], group: 'prospect' },
  { token: 'rating', aliases: ['note'], group: 'prospect' },
  { token: 'reviews', aliases: ['nb_avis'], group: 'prospect' },
  { token: 'website', aliases: ['site'], group: 'prospect' },
  { token: 'first_name', aliases: ['prenom'], group: 'sender' },
  { token: 'last_name', aliases: ['nom'], group: 'sender' },
  { token: 'my_company', aliases: ['societe'], group: 'sender' },
  { token: 'my_email', aliases: ['email'], group: 'sender' },
  { token: 'my_phone', aliases: ['telephone'], group: 'sender' },
  { token: 'my_website', aliases: ['mon_site'], group: 'sender' },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]['token'];

export interface TemplateContext {
  prospect: {
    name: string;
    city: string | null;
    category: string | null;
    rating: number | null;
    review_count: number | null;
    website: string | null;
  };
  sender: {
    first_name: string;
    last_name: string;
    company: string;
    email: string;
    phone: string | null;
    website: string | null;
  } | null;
}

export function emptyTemplates(): CampaignTemplates {
  return { messages: [] };
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

/** Lit la colonne jsonb, quel que soit son format (tableau du lot 0 ou objet). */
export function parseTemplates(raw: unknown): CampaignTemplates {
  const list = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === 'object' &&
        Array.isArray((raw as { messages?: unknown }).messages)
      ? ((raw as { messages: unknown[] }).messages ?? [])
      : [];

  // avant le 1/11/2026 : une seule version courte pour toute la campagne,
  // reprise sous chaque message qui n'a pas encore la sienne
  const legacyShort =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? asString((raw as { short?: Record<string, unknown> }).short?.body)
      : '';

  const messages = list
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object'),
    )
    .slice(0, MAX_MESSAGES)
    .map((item, index) => ({
      name: asString(item.name) || `Message ${index + 1}`,
      subject: asString(item.subject),
      body: asString(item.body),
      short: asString(item.short) || legacyShort,
    }));

  return { messages };
}

const TOKEN_PATTERN = /\{([a-z_]+)\}/gi;

function resolve(token: string, ctx: TemplateContext): string | null {
  const key = token.toLowerCase();
  const variable = TEMPLATE_VARIABLES.find(
    (item) =>
      item.token === key || (item.aliases as readonly string[]).includes(key),
  );

  if (!variable) return null;

  const { prospect, sender } = ctx;

  switch (variable.token) {
    case 'company':
      return prospect.name;
    case 'city':
      return prospect.city ?? '';
    case 'category':
      return prospect.category ?? '';
    case 'rating':
      return prospect.rating === null ? '' : prospect.rating.toFixed(1);
    case 'reviews':
      return prospect.review_count === null
        ? ''
        : String(prospect.review_count);
    case 'website':
      return prospect.website ?? '';
    case 'first_name':
      return sender?.first_name ?? '';
    case 'last_name':
      return sender?.last_name ?? '';
    case 'my_company':
      return sender?.company ?? '';
    case 'my_email':
      return sender?.email ?? '';
    case 'my_phone':
      return sender?.phone ?? '';
    case 'my_website':
      return sender?.website ?? '';
  }
}

const PROSPECT_VARS = new Set([
  'company',
  'city',
  'category',
  'rating',
  'reviews',
  'website',
]);
const EMPTY_MARK = '\u0000';
const SENTENCE = /[^.!?]*[.!?]+\s*|[^.!?]+$/g;

function canonical(token: string) {
  const key = token.toLowerCase();
  const variable = TEMPLATE_VARIABLES.find(
    (item) =>
      item.token === key || (item.aliases as readonly string[]).includes(key),
  );

  return variable?.token ?? null;
}

/**
 * Remplace les variables ; une variable inconnue est laissée telle quelle.
 * Une info manquante sur l'entreprise (pas de note, pas d'avis…) retire la
 * phrase qui la contient, pour ne jamais écrire « : /5 avec avis ». Même
 * règle que templates.py côté worker.
 */
export function renderTemplate(text: string, ctx: TemplateContext) {
  const out = text.replace(TOKEN_PATTERN, (match, token: string) => {
    const value = resolve(token, ctx);

    if (value === null) return match;

    const key = canonical(token);

    return value === '' && key && PROSPECT_VARS.has(key) ? EMPTY_MARK : value;
  });

  if (!out.includes(EMPTY_MARK)) return out;

  const cleaned = out
    .split('\n')
    .map((line) => {
      if (!line.includes(EMPTY_MARK)) return line;

      const parts = line.match(SENTENCE) ?? [line];

      return parts
        .filter((part) => !part.includes(EMPTY_MARK))
        .join('')
        .trimEnd();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');

  return cleaned.trim() === '' ? out.replaceAll(EMPTY_MARK, '') : cleaned;
}

/** Variables inconnues présentes dans un texte (fautes de frappe). */
export function unknownVariables(text: string) {
  const found = new Set<string>();

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[1]!.toLowerCase();
    const known = TEMPLATE_VARIABLES.some(
      (item) =>
        item.token === token ||
        (item.aliases as readonly string[]).includes(token),
    );

    if (!known) found.add(match[0]);
  }

  return [...found];
}

/** Le message mentionne la société de l'expéditeur (variable ou nom en clair). */
export function mentionsCompany(body: string, company: string | null) {
  if (/\{(my_company|societe)\}/i.test(body)) return true;

  const name = company?.trim();

  return Boolean(name) && body.toLowerCase().includes(name!.toLowerCase());
}

/** Messages réellement utilisables pour la préparation (texte non vide). */
export function usableMessages(templates: CampaignTemplates) {
  return templates.messages.filter((message) => message.body.trim() !== '');
}
