/**
 * Clé de site : domaine normalisé servant à dédoublonner les prospects.
 *
 * Port fidèle de la version Python du moteur de scan (workers/). Les deux
 * implémentations DOIVENT produire la même clé pour une même URL, sinon un
 * prospect importé et le même prospect découvert sur Google Maps ne seraient
 * pas reconnus comme doublons. Le découpage d'URL reproduit
 * `urllib.parse.urlsplit` plutôt que `new URL()`, qui normalise l'hôte
 * (punycode) et le chemin différemment.
 */

const PLATFORMS = new Set([
  'doctolib.fr',
  'maiia.com',
  'keldoc.com',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'linktr.ee',
  'pagesjaunes.fr',
  'solocal.com',
  'site-solocal.com',
  'booking.com',
  'airbnb.fr',
  'airbnb.com',
  'tripadvisor.fr',
  'tripadvisor.com',
  'google.com',
  'google.fr',
  'business.site',
  'sites.google.com',
  'wixsite.com',
  'wix.com',
  'jimdo.com',
  'jimdofree.com',
  'webnode.fr',
  'e-monsite.com',
  'free.fr',
  'wordpress.com',
  'blogspot.com',
  'over-blog.com',
  'canalblog.com',
  'weebly.com',
  'godaddysites.com',
  'square.site',
  'ueniweb.com',
  'planity.com',
  'treatwell.fr',
  'thefork.fr',
  'lafourchette.com',
  'ubereats.com',
  'deliveroo.fr',
  'just-eat.fr',
  'order.store',
  'pappers.fr',
  'societe.com',
  'lacentrale.fr',
  'leboncoin.fr',
  't.me',
  'wa.me',
  'calendly.com',
  'linkin.bio',
  'beacons.ai',
  'carrd.co',
  'notion.site',
  'yelp.fr',
  'yelp.com',
  'tiqets.com',
  'mappy.com',
  'justacote.com',
  '123devis.com',
  'habitatpresto.com',
  'starofservice.com',
  'doordash.com',
  'grubhub.com',
  'toasttab.com',
  'squareup.com',
  'clover.com',
  'vagaro.com',
  'schedulicity.com',
  'mindbodyonline.com',
  'booksy.com',
  'fresha.com',
  'setmore.com',
  'zocdoc.com',
]);

const SECOND_LEVEL = new Set([
  'co',
  'com',
  'org',
  'net',
  'gouv',
  'asso',
  'ac',
  'edu',
  'gov',
]);

const SCHEME_CHARS = /^[a-zA-Z0-9+\-.]+$/;

interface ParsedUrl {
  hostname: string | null;
  path: string;
}

/** Équivalent de `urllib.parse.urlsplit(url)` limité à hostname et path. */
function splitUrl(input: string): ParsedUrl | null {
  // urlsplit supprime les tabulations et retours à la ligne, puis les
  // caractères de contrôle et espaces en tête.
  // eslint-disable-next-line no-control-regex
  let url = input.replace(/[\t\r\n]/g, '').replace(/^[\u0000- ]+/, '');

  const colon = url.indexOf(':');

  if (colon > 0 && /^[a-zA-Z]$/.test(url[0]!)) {
    const scheme = url.slice(0, colon);

    if (SCHEME_CHARS.test(scheme)) {
      url = url.slice(colon + 1);
    }
  }

  let netloc = '';

  if (url.startsWith('//')) {
    let end = url.length;

    for (const delimiter of ['/', '?', '#']) {
      const index = url.indexOf(delimiter, 2);

      if (index >= 0 && index < end) {
        end = index;
      }
    }

    netloc = url.slice(2, end);
    url = url.slice(end);

    // urlsplit lève ValueError (« Invalid IPv6 URL ») dans ce cas
    if (netloc.includes('[') !== netloc.includes(']')) {
      return null;
    }
  }

  const hashIndex = url.indexOf('#');

  if (hashIndex >= 0) {
    url = url.slice(0, hashIndex);
  }

  const queryIndex = url.indexOf('?');

  if (queryIndex >= 0) {
    url = url.slice(0, queryIndex);
  }

  return { hostname: getHostname(netloc), path: url };
}

/** Équivalent de `SplitResult.hostname`. */
function getHostname(netloc: string) {
  const hostinfo = netloc.slice(netloc.lastIndexOf('@') + 1);
  let hostname: string;

  if (hostinfo.includes('[')) {
    const start = hostinfo.indexOf('[') + 1;
    const end = hostinfo.indexOf(']', start);

    hostname = hostinfo.slice(start, end >= 0 ? end : undefined);
    hostname = hostname.split('%')[0] ?? '';
  } else {
    hostname = hostinfo.split(':')[0] ?? '';
  }

  return hostname ? hostname.toLowerCase() : null;
}

function parse(url: string) {
  return splitUrl(url.includes('://') ? url : `http://${url}`);
}

function removeWww(host: string) {
  return host.startsWith('www.') ? host.slice(4) : host;
}

function rstripSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

/** Domaine enregistrable : « shop.example.co.uk » → « example.co.uk ». */
export function domainOf(url: string) {
  const parsed = parse(url);

  if (!parsed) {
    return null;
  }

  const host = removeWww(parsed.hostname ?? '');
  const parts = host.split('.');

  if (parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]!)) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

/**
 * Clé de dédoublonnage d'un site web, ou `null` si l'URL est inexploitable.
 * Pour une plateforme (Facebook, Doctolib…), la clé garde le chemin, car
 * deux entreprises différentes partagent le même domaine.
 */
export function siteKey(url: string | null | undefined) {
  if (!url || !url.trim()) {
    return null;
  }

  const trimmed = url.trim();
  const domain = domainOf(trimmed);

  if (!domain || !domain.includes('.')) {
    return null;
  }

  const parsed = parse(trimmed);

  if (!parsed) {
    return null;
  }

  const host = removeWww(parsed.hostname ?? '');

  if (PLATFORMS.has(domain) || PLATFORMS.has(host)) {
    return `${host}${rstripSlashes(parsed.path)}`.toLowerCase();
  }

  return domain;
}
