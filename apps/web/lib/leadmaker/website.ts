/**
 * Liens vers le site d'un prospect ou l'URL d'un formulaire de contact (client et serveur).
 *
 * Les valeurs viennent de la base (fiche de l'entreprise, import CSV, robots) :
 * on ne fait jamais confiance à leur schéma. `websiteHref` ne renvoie qu'une
 * URL http(s) ; tout autre schéma (`javascript:`, `data:`, `mailto:`…) donne
 * `null`, et l'appelant affiche alors du texte simple au lieu d'un lien.
 */

/** Un schéma en tête (`javascript:`, `mailto:`…), mais pas `exemple.com:8080`. */
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const HTTP = /^https?:\/\//i;

/**
 * URL cliquable d'un site : telle quelle si elle commence par http(s)://,
 * préfixée de https:// si elle n'a pas de schéma, `null` sinon (ou si elle
 * n'est pas une URL valide).
 */
export function websiteHref(url: string | null | undefined) {
  const value = url?.trim();

  if (!value) {
    return null;
  }

  if (!HTTP.test(value) && SCHEME.test(value)) {
    return null;
  }

  const href = HTTP.test(value) ? value : `https://${value}`;

  try {
    const parsed = new URL(href);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  return href;
}

/**
 * Libellé court d'un site : sans http(s):// ni www.
 * `keepPath` : garde le chemin (seule la barre finale est retirée) ;
 * sinon seul le domaine reste.
 */
export function websiteLabel(
  url: string,
  options: { keepPath?: boolean } = {},
) {
  const bare = url.replace(/^https?:\/\/(www\.)?/i, '');

  return options.keepPath ? bare.replace(/\/$/, '') : bare.replace(/\/.*$/, '');
}
