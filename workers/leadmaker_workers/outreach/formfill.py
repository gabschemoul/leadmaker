"""Trouve le formulaire de contact d'un site et remplit ses champs (repris du prototype, règles de l'annexe 13).

Étapes : page d'accueil → lien « Contact » (dans la langue du site) → formulaire avec une zone de message
et un champ email ou téléphone → chaque champ visible est identifié (nom, email, téléphone, société, objet,
message…) et rempli. Les champs invisibles (pièges anti-robots) ne sont jamais touchés, les cases newsletter
jamais cochées ; les captchas sont détectés par type, jamais résolus ici.
"""
from __future__ import annotations

import re
import time
import unicodedata
from dataclasses import dataclass, field
from urllib.parse import urlparse

from playwright.sync_api import Frame, Page, TimeoutError as PWTimeout

# Mots « contact » par langue (fr, en, de, es, it, pt, nl, pl, tr…)
CONTACT_LINK = re.compile(
    r"contact|contactez|contacteer|contacto|contatt|contato|kontakt|nous[- ]?ecrire|ecrivez|joindre|devis|formulaire"
    r"|get[- ]?in[- ]?touch|reach[- ]?us|request[- ]?a[- ]?quote|free[- ]?quote|get[- ]?a[- ]?quote|estimate|inquir"
    r"|anfrage|angebot|presupuesto|preventivo|orcamento|offerte|iletisim|お問い合わせ|联系", re.I)
NOT_CONTACT = re.compile(r"mentions|cgv|cgu|legal|politique|recrut|carriere|job|privacy|terms|career|employment|hiring"
                         r"|impressum|datenschutz|aviso|emploi|stellen|karriere|vacature|lavora", re.I)
SUCCESS = re.compile(
    r"merci|bien (ete )?(envoye|recu|transmis)|a ete envoye|message (a ete )?envoye|nous vous (repondrons|recontacterons)"
    r"|thank|has been sent|success|we('ll| will) (be in touch|get back|contact you|respond)|been (received|submitted)"
    r"|message (was )?sent|submission (was )?(received|successful)|vielen dank|gracias|grazie|obrigad|bedankt", re.I)
FAILURE = re.compile(
    r"recaptcha[^.]{0,60}(echoue|invalide|failed)|utilisation abusive|(envoi|message)[^.]{0,30}(a echoue|n'a pas pu)"
    r"|n'a pas pu etre envoye|une erreur (s'est produite|est survenue)|formulaire non valide|failed to send"
    r"|there was an error|spam detecte|please try again|could not be (sent|submitted)|unable to (send|submit)"
    r"|an error (has )?occurred|captcha (verification )?failed|invalid captcha|flagged as spam", re.I)

# Protections visibles, par type (le reCAPTCHA v3 invisible n'en est pas une)
PROTECTIONS = [
    ("recaptcha_v2", 'iframe[src*="recaptcha"]:not([src*="size=invisible"]):visible, .g-recaptcha:not([data-size="invisible"]):visible'),
    ("hcaptcha", 'iframe[src*="hcaptcha"]:visible, .h-captcha:visible'),
    ("turnstile", '.cf-turnstile:visible, iframe[src*="challenges.cloudflare"]:visible'),
    ("friendlycaptcha", 'iframe[src*="friendlycaptcha"]:visible, .frc-captcha:visible'),
]

COUNTRY = r"\bpays\b|country|\bland\b|pais|paese"
CIVILITY = r"civilit|salutation|\bgenre\b|\bsexe\b|anrede|tratamiento|\btitel\b|aanhef"
CIV_F = re.compile(r"^\W*(madame|mme\.?|mrs\.?|ms\.?|miss|mademoiselle|mlle|frau|sra\.?|senora|señora|signora"
                   r"|mevrouw|mevr\.?|senhora)\W*$", re.I)
CIV_M = re.compile(r"^\W*(monsieur|m\.|mr\.?|herr|sr\.?|senor|señor|signor|meneer|dhr\.?|senhor)\W*$", re.I)
FIELD_RULES = [
    ("civility", CIVILITY),
    ("email", r"e-?mail|courriel|\bmail\b|correo"),
    ("phone", r"t[eé]l|phone|portable|mobile|gsm|joindre|telefon|handy|mobil|cellulare|telemovel|celular"),
    ("phone", r"^(?!.*(siret|siren|tva|commande|order|dossier|serie|suivi|contrat|client|facture|locataire|adherent|membre"
              r"|rue|voie|voirie|maison|street|departement|immat|reservation|carte|adeli|rpps|\brg\b|redevable"
              r"|appartement|ligne|licence|permis|securite sociale|kunden|rechnung|bestell|pedido|ordine)).*(\bnumero\b|\bn°|\bnumber\b|\bnummer\b)"),
    ("full_name", r"nom (et|&|/) ?pr[eé]nom|pr[eé]nom (et|&|/) ?nom|nom complet|full ?name|vor- und nachname|nombre completo|nome completo"),
    ("first_name", r"pr[eé]nom|first|given|fname|vorname|voornaam"),
    ("company", r"soci[eé]t[eé]|entreprise|company|organi[sz]ation|raison sociale|structure|etablissement|business|firma"
                r"|unternehmen|empresa|azienda|bedrijf"),
    ("subject", r"objet|sujet|subject|motif|regarding|topic|betreff|asunto|oggetto|onderwerp|assunto"),
    ("zip", r"code postal|postal|zip|\bcp\b|\bplz\b|postleitzahl|codigo postal|\bcap\b|postcode"),
    ("country", COUNTRY),
    ("job_title", r"fonction|job ?title|\bjob\b|intitule (du |de )?poste|poste occupe|votre poste|^\W*poste\b\W*\*?\W*$"
                  r"|\bposition\b|titre de fonction|\bcargo\b|\bfunktion\b|\bruolo\b|\bfunctie\b"),
    ("location", r"\blieu (du|de|d'|des)|localisation|^\W*location\W*\*?\W*$|select a location"),
    ("city", r"ville|city|commune|localit|stadt|\bort\b|ciudad|citta|cidade|plaats|woonplaats"),
    ("address", r"adresse|address|\brue\b|strasse|straße|direccion|indirizzo|endereco|adres"),
    ("website", r"\bsite\b|\burl\b|website|\bweb\b|webseite|sitio|sito"),
    ("last_name", r"\bnom\b|last|surname|lname|family|nachname|apellido|cognome|achternaam|sobrenome"),
    ("full_name", r"\bname\b|votre nom|\bnombre\b|\bnome\b|\bnaam\b"),
    ("message", r"message|commentaire|demande|question|comment|precisions|description|texte|body|content|how can we help"
                r"|nachricht|anliegen|mensaje|consulta|messaggio|richiesta|bericht|mensagem"),
]
CONSENT = re.compile(r"rgpd|gdpr|consent|accepte|j'accepte|politique|confidentialit|donnees personnelles|privacy|conditions"
                     r"|cgu|cgv|i agree|agree to the|terms|datenschutz|einverstanden|zustimm|acepto|privacidad|accetto"
                     r"|informativa|akkoord|concordo", re.I)
NEWSLETTER = re.compile(r"newsletter|lettre d'information|actualit|offres? (commerciales|promotionnelles)|partenaires"
                        r"|etre (re)?contacte|me contacter|par telephone|sms|subscribe|mailing list|marketing|promotion"
                        r"|special offers|text messages?|receive (updates|news|offers|emails|texts)|werbung|boletin"
                        r"|novedades|nieuwsbrief", re.I)
# Captchas « à recopier » (image, calcul)
CAPTCHA_TEXT = re.compile(r"code de securite|entre[rz]? le code|recopie|antispam|anti-spam|combien font|resultat de l'operation"
                          r"|(?<!re)captcha|security code|enter the (code|characters)|what is \d+|solve|math question"
                          r"|prove you|sicherheitscode|rechenaufgabe|codigo de seguridad|codice di sicurezza", re.I)
MATH_TEXT = re.compile(r"combien font|resultat de l'operation|what is \d+|math question|rechenaufgabe|\d+\s*[+×x*-]\s*\d+\s*=", re.I)
CONTACT_PATHS = ["/contact", "/contact-us", "/contact/", "/contact-us/", "/contactus", "/contact.html", "/contact-us.html",
                 "/contact.php", "/nous-contacter", "/kontakt", "/kontakt/", "/contacto", "/contacto/", "/contatti",
                 "/contatti/", "/contato", "/get-in-touch"]
SELECT_PREF = re.compile(r"autre|other|information|renseignement|partenariat|commercial|demande|general|contact|sonstige"
                         r"|otro|altro|anders|outro", re.I)
SUBMIT = re.compile(r"envoy|send|valider|soumettre|submit|contact|transmettre|demander|go\b|ok\b|senden|absenden|enviar"
                    r"|invia|verstuur|verzend", re.I)
EMAIL = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.I)
EMAIL_SKIP = re.compile(r"\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|example\.|wixpress|domain\.com|email\.com|yourdomain"
                        r"|@2x|godaddy|placeholder|noreply|no-reply", re.I)


# Pages de domaine mort, boutique fermée, site en construction : inutile de chercher un formulaire
DEAD_SITE = re.compile(r"site not found|boutique indisponible|shop (is )?(unavailable|closed)|domain (is )?for sale|ce domaine"
                       r"|domaine (est )?(a vendre|en vente)|site en construction|under construction|coming soon|parked"
                       r"|account (has been )?suspended|site suspendu|page introuvable|404 not found|403 forbidden|404: not found"
                       r"|en maintenance|maintenance mode|website (is )?(temporarily )?unavailable|site (temporairement )?indisponible"
                       r"|hebergement (web )?(gratuit|offert)|this site is (currently )?unavailable|expired"
                       r"|site non installe|site web indisponible|wordpress . erreur|erreur de base de donnees|database error"
                       r"|error establishing a database|is for sale|hugedomains|sedo\.com|dan\.com|default page|web server's default"
                       r"|it works!|welcome to nginx|apache2 .*default|index of /|tunnel error|reconnect your domain"
                       r"|future home of|bientot disponible|site en cours de creation|cette page est en construction"
                       r"|\b40[34]\b|site (est )?hors ligne|this site is offline|not found", re.I)
# Protections au niveau du site (pas du formulaire) : le robot est bloqué avant même de voir la page
PROTECTED_SITE = re.compile(r"attention required|just a moment|checking your browser|verify you are human|un instant"
                            r"|captcha-delivery|datadome|ddos-guard|access denied|acces refuse|bot detection", re.I)
PROTECTED_FRAME = re.compile(r"captcha-delivery|datadome|challenges\.cloudflare|ddos-guard|perimeterx|px-cdn", re.I)
# Formulaires hébergés ailleurs (le lien sort du site, on y va quand même)
FORM_SERVICES = re.compile(r"typeform\.com|jotform\.com|docs\.google\.com/forms|forms\.gle|tally\.so|forms\.office\.com"
                           r"|hsforms\.com|cognitoforms\.com|wufoo\.com|formstack\.com|123formbuilder|zohopublic|forms\.zoho"
                           r"|airtable\.com/(app|shr)|paperform\.co|forms\.app|fillout\.com", re.I)
HONEYPOT = re.compile(r"^(hp|honeypot|honey|bot-?field|_gotcha|url_hp|website_hp|fax|trap|leave-?blank|do-?not-?fill)$|honeypot|gotcha", re.I)
# Budget de temps par site pour la recherche du formulaire (le dépassement arrête les pages suivantes)
SITE_BUDGET = 55.0
NEXT_BUTTON = re.compile(r"suivant|next|continuer|continue|etape suivante|weiter|siguiente|avanti|volgende|commencer|demarrer"
                         r"|start|c'est parti|valider (l'|cette )?etape", re.I)


QSA_JS = r"""
  const qsa = (root, sel) => { const out = [...root.querySelectorAll(sel)];
    root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) out.push(...qsa(e.shadowRoot, sel)); }); return out; };
  const up = e => e.parentElement || (e.getRootNode() instanceof ShadowRoot ? e.getRootNode().host : null);
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    // coordonnées dans le document (la page a pu être déroulée) : un champ placé hors écran est un piège
    const left = r.left + scrollX, top = r.top + scrollY;
    return r.width > 2 && r.height > 2 && left + r.width > 0 && top + r.height > 0 && left < innerWidth * 2
      && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const labelFor = el => el.id ? (el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`) || null) : null;"""


class SiteDown(Exception):
    """Le site répond mais n'est plus un vrai site (domaine expiré, boutique fermée, en construction)."""


@dataclass
class Sender:
    first_name: str = ""
    last_name: str = ""
    company: str = ""
    email: str = ""
    phone: str = ""
    website: str = ""
    city: str = ""
    zip: str = ""
    address: str = ""
    job_title: str = ""
    civility: str = ""            # "mrs", "mr" ou ""
    country_names: list = field(default_factory=list)  # noms du pays dans plusieurs langues


@dataclass
class FillResult:
    status: str  # "filled", "captcha", "error"
    form_url: str = ""
    filled: dict = field(default_factory=dict)  # type de champ -> libellé du champ
    missing: list = field(default_factory=list)  # libellés des champs obligatoires non remplis
    warnings: list = field(default_factory=list)  # explications lisibles
    short: bool = False  # zone de message trop courte : le message court a été utilisé
    protection: str | None = None
    detail: str = ""


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _same_site(url: str, base: str) -> bool:
    a, b = urlparse(url).hostname or "", urlparse(base).hostname or ""
    return a.removeprefix("www.") == b.removeprefix("www.")


# Repère dans un cadre (page ou iframe) le meilleur formulaire de contact : au moins un champ email ou
# téléphone et deux champs au total. Les champs des étapes suivantes (invisibles au départ) comptent pour la
# détection ; seuls les champs visibles sont remplis ensuite. Recherche, newsletter, connexion, chat IA,
# éditeurs et formulaires mailto: sont ignorés. Les formulaires sans balise <form> (React, Wix, tunnels) sont
# retrouvés à partir de leurs champs.
FIND_FORM_JS = r"""
() => {
  const qsa = (root, sel) => { const out = [...root.querySelectorAll(sel)];
    root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) out.push(...qsa(e.shadowRoot, sel)); }); return out; };
  const up = e => e.parentElement || (e.getRootNode() instanceof ShadowRoot ? e.getRootNode().host : null);
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    // coordonnées dans le document (la page a pu être déroulée) : un champ placé hors écran est un piège
    const left = r.left + scrollX, top = r.top + scrollY;
    return r.width > 2 && r.height > 2 && left + r.width > 0 && top + r.height > 0 && left < innerWidth * 2
      && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const labelFor = el => el.id ? (el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`) || null) : null;
  const FIELD = 'input:not([type=hidden]),textarea,select';
  const isRoot = p => !p || p === document.body || p === document.documentElement;
  const containers = qsa(document, 'form').filter(f => !/^mailto:/i.test(f.getAttribute('action') || ''));
  // Champs hors <form> (React, Wix, composants web…) : on remonte jusqu'à un bloc qui en contient au moins trois.
  qsa(document, 'input[type=email],input[type=tel],textarea,input[type=text]').forEach(t => {
    if (t.closest('form')) return;
    let p = up(t);
    for (let i = 0; i < 8 && !isRoot(p) && qsa(p, FIELD).length < 3; i++) p = up(p);
    if (!isRoot(p) && !containers.includes(p) && !containers.some(c => c.contains(p) || p.contains(c))) containers.push(p);
  });
  const text = e => [e.type, e.name, e.id, e.placeholder, e.getAttribute('aria-label'),
    (labelFor(e) || {}).innerText, e.closest('label') && e.closest('label').innerText].join(' ');
  let best = -1, bestScore = 0;
  containers.forEach((f, i) => {
    const fields = qsa(f, FIELD).filter(e => !['submit', 'button', 'image', 'reset'].includes(e.type));
    if (fields.length < 2) return;
    const visible = fields.filter(vis).length;
    const ta = fields.filter(e => e.tagName === 'TEXTAREA').length;
    const msg = ta || fields.filter(e => /message|comment|demande|question|nachricht|mensaje|messaggio|bericht/i.test(text(e))).length;
    const pwd = fields.filter(e => e.type === 'password').length;
    const search = fields.filter(e => e.type === 'search' || /^(s|q|search|recherche|suche|busca)$/i.test(e.name||'')).length;
    const reply = fields.filter(e => e.tagName === 'INPUT' && (['email', 'tel'].includes(e.type)
      || /mail|courriel|correo|t[ée]l[ée]?phone|\btel\b|phone|portable|mobile|telefon|handy/i.test(text(e)))).length;
    const named = fields.filter(e => e.tagName === 'INPUT' && /\bnom\b|name|pr[ée]nom|first|last|vorname|nachname|nombre|nome|naam/i.test(text(e))).length;
    if (pwd || search >= fields.length / 2) return;
    // sans champ de réponse (email/téléphone), seul un formulaire « nom + message » est accepté
    if (!reply && !(ta && named)) return;
    const score = (ta ? 5 : 0) + (msg ? 3 : 0) + (reply ? 3 : 0) + Math.min(fields.length, 8) + (visible ? 2 : 0) - (f.tagName === 'FORM' ? 0 : 2);
    if (score > bestScore) { best = i; bestScore = score; }
  });
  if (best < 0) return null;
  containers.forEach(f => f.removeAttribute('data-ff-form'));
  containers[best].setAttribute('data-ff-form', '1');
  return bestScore;
}
"""

DESCRIBE_JS = r"""
() => {
  const qsa = (root, sel) => { const out = [...root.querySelectorAll(sel)];
    root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) out.push(...qsa(e.shadowRoot, sel)); }); return out; };
  const up = e => e.parentElement || (e.getRootNode() instanceof ShadowRoot ? e.getRootNode().host : null);
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    // coordonnées dans le document (la page a pu être déroulée) : un champ placé hors écran est un piège
    const left = r.left + scrollX, top = r.top + scrollY;
    return r.width > 2 && r.height > 2 && left + r.width > 0 && top + r.height > 0 && left < innerWidth * 2
      && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const labelFor = el => el.id ? (el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`) || null) : null;
  const form = qsa(document, '[data-ff-form]')[0];
  if (!form) return [];
  const labelOf = el => {
    let t = '';
    const l = labelFor(el); if (l) t += l.innerText;
    const pl = el.closest('label'); if (pl) t += ' ' + pl.innerText;
    if (el.getAttribute('aria-label')) t += ' ' + el.getAttribute('aria-label');
    if (!t.trim()) { let p = up(el); for (let i = 0; i < 2 && p; i++, p = up(p)) {
      const txt = [...p.childNodes].filter(n => n.nodeType === 3 || ['LABEL','SPAN','P','DIV','LEGEND'].includes(n.tagName))
        .map(n => (n.innerText || n.textContent || '')).join(' ').trim();
      if (txt && txt.length < 120) { t = txt; break; } } }
    return t.replace(/\s+/g, ' ').trim().slice(0, 120);
  };
  const labelVis = el => { const l = labelFor(el) || el.closest('label'); return !!(l && vis(l)); };
  // image captcha à recopier (le logo reCAPTCHA/hCaptcha n'en est pas une)
  const captchaImg = qsa(form, 'img[src*="captcha" i], input[name*="captcha" i]:not([type=hidden]), '
    + 'img[id*="captcha" i], img[class*="captcha" i]').filter(e => !/recaptcha|hcaptcha|logo/i.test(e.src || '')).length > 0;
  return qsa(form, 'input,textarea,select').map((el, i) => {
    el.setAttribute('data-ff-i', String(i));
    const box = el.type === 'checkbox' || el.type === 'radio';
    return { i, tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), name: el.name || '', id: el.id || '',
      placeholder: el.placeholder || '', label: labelOf(el), required: el.required || el.getAttribute('aria-required') === 'true'
        || /\*/.test(labelOf(el)), visible: vis(el) || (box && (labelVis(el) || (up(el) && vis(up(el))))), autocomplete: el.autocomplete || '',
      captchaImg,
      options: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()) : [] };
  });
}
"""

VALIDATE_JS = r"""
(prefs) => {
  const qsa = (root, sel) => { const out = [...root.querySelectorAll(sel)];
    root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) out.push(...qsa(e.shadowRoot, sel)); }); return out; };
  const up = e => e.parentElement || (e.getRootNode() instanceof ShadowRoot ? e.getRootNode().host : null);
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    // coordonnées dans le document (la page a pu être déroulée) : un champ placé hors écran est un piège
    const left = r.left + scrollX, top = r.top + scrollY;
    return r.width > 2 && r.height > 2 && left + r.width > 0 && top + r.height > 0 && left < innerWidth * 2
      && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const labelFor = el => el.id ? (el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`) || null) : null;
  const form = qsa(document, '[data-ff-form]')[0];
  if (!form) return {invalid: [], truncated: 0};
  const els = qsa(form, '[data-ff-i]').filter(el => el.willValidate);
  const fire = el => ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, {bubbles: true})));
  const countries = (prefs.countries || []).map(c => c.toLowerCase());
  const civ = prefs.civility ? new RegExp(prefs.civility, 'i') : null;
  for (const el of els) {
    if (el.checkValidity()) continue;
    if (el.tagName === 'SELECT') {
      const ok = [...el.options].filter(o => o.value && !o.disabled);
      const o = ok.find(o => countries.includes(o.text.trim().toLowerCase()))
        || (civ && ok.find(o => civ.test(o.text))) || ok[0];
      if (o) { el.value = o.value; fire(el); }
    } else if (el.type === 'radio' && el.name) {
      const first = qsa(form, `input[type=radio][name="${CSS.escape(el.name)}"]`)[0];
      if (first) { first.checked = true; fire(first); }
    }
  }
  const ta = qsa(form, 'textarea').find(t => t.maxLength > 0 && t.value.length >= t.maxLength);
  return {invalid: els.filter(el => !el.checkValidity()).map(el => +el.dataset.ffI), truncated: ta ? ta.maxLength : 0};
}
"""

EMAILS_JS = r"""
() => {
  const out = [];
  document.querySelectorAll('a[href^="mailto:"]').forEach(a => out.push(a.getAttribute('href').slice(7).split('?')[0]));
  out.push(document.body ? document.body.innerText : '');
  return out.join('\n');
}
"""


def classify(f: dict) -> str | None:
    if f["tag"] == "textarea":
        return "message"
    if f["type"] in ("hidden", "submit", "button", "image", "reset", "file", "password", "search"):
        return None
    if f["type"] == "email":
        return "email"
    if f["type"] in ("tel", "number", "text"):  # le libellé prime sur un type mal choisi par le site
        lbl = _norm(f"{f['label']} {f['placeholder']}")
        if re.search(r"e-?mail|courriel|correo", lbl):
            return "email"
        if re.search(r"code postal|postal|zip|\bplz\b", lbl):
            return "zip"
    if f["type"] == "tel":
        return "phone"
    if f["type"] == "url":
        return "website"
    if f["type"] in ("checkbox", "radio"):
        return f["type"]
    if f["tag"] == "select":
        return "select"
    ac = f.get("autocomplete", "")
    ac_map = {"given-name": "first_name", "family-name": "last_name", "name": "full_name", "email": "email",
              "tel": "phone", "organization": "company", "postal-code": "zip", "address-level2": "city",
              "organization-title": "job_title", "url": "website"}
    if ac in ac_map:
        return ac_map[ac]
    text = _norm(" ".join([f["label"], f["placeholder"], f["name"], f["id"]]))
    for kind, pattern in FIELD_RULES:
        if re.search(pattern, text):
            return kind
    return "unknown"


def _values(sender: Sender, subject: str, message: str) -> dict[str, str]:
    country = sender.country_names[0] if sender.country_names else ""
    return {
        "email": sender.email, "phone": sender.phone, "first_name": sender.first_name, "last_name": sender.last_name,
        "full_name": f"{sender.first_name} {sender.last_name}".strip(), "company": sender.company, "subject": subject,
        "message": message, "website": sender.website, "city": sender.city, "zip": sender.zip,
        "address": sender.address, "country": country, "civility": sender.civility,
        "job_title": sender.job_title, "location": country,
    }


def _civ_regex(sender: Sender):
    return CIV_M if sender.civility == "mr" else CIV_F if sender.civility == "mrs" else None


# Iframes qui ne contiennent jamais de formulaire de contact (cartes, vidéos, pubs, pixels) : jamais interrogées,
# certaines ne répondent jamais et bloqueraient le robot
SKIP_FRAME = re.compile(r"google\.com/maps|maps\.google|openstreetmap|youtube|youtu\.be|vimeo|dailymotion|recaptcha|hcaptcha"
                        r"|doubleclick|googlesyndication|googletagmanager|google-analytics|facebook\.com/plugins|facebook\.com/tr"
                        r"|twitter\.com/widgets|platform\.twitter|instagram\.com/embed|tiktok\.com/embed|spotify|soundcloud"
                        r"|cookie|consent|didomi|onetrust|axeptio|usercentrics|sourcepoint|quantcast|iubenda|cookiebot"
                        r"|trustpilot|avis-verifies|hotjar|clarity\.ms|bing\.com|linkedin\.com/px|snapchat|pinterest|tawk\.to"
                        r"|crisp\.chat|intercom|zendesk|livechat|calendly", re.I)


REVEAL_BUTTON = re.compile(r"particulier|contact|devis|message|ecrire|rendez|demande|quote|get in touch|inquir|kontakt|anfrage"
                           r"|contacto|presupuesto|contatt|preventivo|choisir", re.I)
REVEAL_JS = "(args) => {" + QSA_JS + r"""
  const [pattern, notPattern] = args; const rx = new RegExp(pattern, 'i'), bad = new RegExp(notPattern, 'i');
  const cands = qsa(document, 'button, [role=button], a[href="#"], a[href^="#"], a[href^="javascript"], a:not([href]), [data-toggle], [data-popup], [data-elementor-open-popup], .elementor-button')
    .filter(el => vis(el) && !/^(tel:|mailto:)/i.test(el.getAttribute('href') || ''));
  for (const el of cands) {
    const t = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
    if (t && t.length < 50 && rx.test(t) && !bad.test(t)) { el.scrollIntoView({block: 'center'}); el.click(); return t; }
  }
  return null;
}
"""


def _click_reveal(page: Page) -> str | None:
    """Clique sur un bouton qui semble ouvrir le formulaire (fenêtre, assistant « particulier / professionnel »)."""
    try:
        return page.main_frame.evaluate(REVEAL_JS, [REVEAL_BUTTON.pattern, NOT_CONTACT.pattern])
    except Exception:
        return None


def _find_form_after_click(page: Page, visited: list[str]) -> Frame | None:
    """Sans formulaire visible : un clic sur un bouton « contact / devis / particulier » peut l'afficher."""
    label = _click_reveal(page)
    if not label:
        return None
    page.wait_for_timeout(1500)
    visited.append(f"clic « {label[:30]} »")
    frame = _find_form(page)
    if frame:
        return frame
    # assistant en deux temps (« Particulier » puis « Demander un devis »)
    label = _click_reveal(page)
    if label:
        page.wait_for_timeout(1500)
        visited.append(f"clic « {label[:30]} »")
        return _find_form(page)
    return None


def _find_form(page: Page) -> Frame | None:
    # cadres sans adresse : jamais chargés (ou détachés), ils ne répondent pas aux appels
    frames = [page.main_frame] + [f for f in page.frames if f != page.main_frame and f.url and not SKIP_FRAME.search(f.url)]
    for frame in frames[:12]:
        try:
            if frame.evaluate(FIND_FORM_JS):
                return frame
        except Exception:
            continue
    return None


def _contact_links(page: Page, base: str) -> list[str]:
    links = page.evaluate("""() => [...document.querySelectorAll('a[href]')].map(a => [a.href, (a.innerText || a.title || a.getAttribute('aria-label') || '').trim()])""")
    scored = []
    for href, text in links:
        if not href.startswith("http"):
            continue
        if not _same_site(href, base):
            if FORM_SERVICES.search(href):  # formulaire hébergé ailleurs : essayé après les pages du site
                scored.append((0, href))
            continue
        t = _norm(f"{text} {urlparse(href).path}")
        if CONTACT_LINK.search(t) and not NOT_CONTACT.search(t):
            score = 2 if re.search(r"contact|kontakt|contatt|contato", t) else 1
            scored.append((score, href.split("#")[0]))
    seen, out = set(), []
    for _, h in sorted(scored, key=lambda x: -x[0]):
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out[:4]


def _scroll(page: Page):
    for _ in range(3):
        page.mouse.wheel(0, 2500)
        page.wait_for_timeout(250)


def _load(page: Page, url: str, timeout: int):
    page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    page.wait_for_timeout(1500)
    _dismiss_cookies(page)
    _scroll(page)
    page.wait_for_timeout(500)


def _find_form_late(page: Page) -> Frame | None:
    """Formulaires chargés après coup (Jotform, HubSpot, composants web…) : 2 s de plus."""
    page.wait_for_timeout(2000)
    return _find_form(page)


def harvest_emails(page: Page, site: str, found: set[str]) -> None:
    """Relève les adresses email visibles (liens mailto et texte) ; celles du domaine du site d'abord."""
    try:
        text = page.evaluate(EMAILS_JS)
    except Exception:
        return
    for m in EMAIL.findall(text or ""):
        if not EMAIL_SKIP.search(m):
            found.add(m.lower())


def own_email(site: str, found: set[str]) -> str | None:
    """Adresse au domaine du site (la plus sûre), ou None."""
    host = (urlparse(site if "://" in site else f"http://{site}").hostname or "").removeprefix("www.").lower()
    root = ".".join(host.split(".")[-2:])
    same = sorted(e for e in found if e.endswith("@" + host) or e.endswith("." + root) or e.endswith("@" + root))
    return same[0] if same else None


# Messageries grand public : une adresse chez elles appartient plausiblement à l'entreprise. Une adresse au
# domaine d'une autre société (annuaire, agence web, plateforme) n'est jamais retenue.
WEBMAIL = re.compile(r"@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm"
                     r"|gmx|web|mail|orange|wanadoo|free|sfr|neuf|laposte|bbox|numericable|club-internet|aliceadsl"
                     r"|t-online|freenet|libero|virgilio|tiscali|telenet|skynet|ziggo|kpn|btinternet|sky|comcast|att"
                     r"|verizon|bell|rogers|videotron|uol|bol|terra)\.[a-z.]+$", re.I)


def best_email(site: str, found: set[str]) -> str | None:
    """Adresse à retenir : celle du domaine du site, sinon une messagerie grand public, sinon rien."""
    own = own_email(site, found)
    if own:
        return own
    webmail = sorted(e for e in found if WEBMAIL.search(e))
    return webmail[0] if webmail else None


# Pages qui affichent souvent l'adresse e-mail : mentions légales, à propos, confidentialité
LEGAL_LINK = re.compile(r"mentions|legal|impressum|imprint|aviso|note legali|privacy|confidentialit|a[- ]propos|about"
                        r"|qui[- ]sommes|chi siamo|quienes somos|sobre|uber uns|over ons", re.I)


def legal_links(page: Page, base: str) -> list[str]:
    links = page.evaluate("""() => [...document.querySelectorAll('a[href]')].map(a => [a.href, (a.innerText || a.title || '').trim()])""")
    out: list[str] = []
    for href, text in links:
        if href.startswith("http") and _same_site(href, base) and LEGAL_LINK.search(_norm(f"{text} {urlparse(href).path}")):
            clean = href.split("#")[0]
            if clean not in out:
                out.append(clean)
    return out[:3]


PAGE_STATE_JS = r"""
() => ({ title: document.title || '', text: (document.body ? document.body.innerText : '').trim(),
         links: document.querySelectorAll('a[href]').length,
         inputs: document.querySelectorAll('input:not([type=hidden]),textarea').length,
         passwords: document.querySelectorAll('input[type=password]').length,
         frames: [...document.querySelectorAll('iframe')].map(f => f.src || '').join(' ') })
"""


def _check_alive(page: Page, final: bool = False) -> None:
    """Lève SiteDown pour une page morte (domaine à vendre, hébergeur, erreur), protégée contre les robots,
    en maintenance (connexion seule) ou, après le délai de rendu (final), vide."""
    try:
        st = page.evaluate(PAGE_STATE_JS)
    except Exception:
        return
    title, body = st["title"], st["text"]
    short = len(body) < 800
    if PROTECTED_SITE.search(_norm(title)) or (short and PROTECTED_SITE.search(_norm(body))) or PROTECTED_FRAME.search(st["frames"]):
        raise SiteDown(f"site protégé contre les robots (« {(title or body)[:60].strip()} »)")
    if DEAD_SITE.search(_norm(title)) or (short and DEAD_SITE.search(_norm(body))):
        raise SiteDown((title or body).strip()[:80])
    if short and st["passwords"] and st["inputs"] <= 3 and st["links"] < 5:
        raise SiteDown("site en maintenance : page de connexion seule")
    if final and not body and st["links"] == 0 and st["inputs"] == 0 and len(page.frames) <= 1:
        raise SiteDown("page vide : rien ne s'affiche")


def open_contact_form(page: Page, site: str, timeout: int = 25000, emails: set[str] | None = None,
                      visited: list[str] | None = None) -> Frame | None:
    """Ouvre le site et renvoie le cadre contenant le formulaire de contact (ou None).
    `visited` reçoit les pages explorées (pour expliquer un échec)."""
    emails = emails if emails is not None else set()
    visited = visited if visited is not None else []
    started = time.monotonic()
    _load(page, site, timeout)
    _check_alive(page)
    visited.append("accueil")
    harvest_emails(page, site, emails)
    frame = _find_form(page) or _find_form_late(page)
    if frame:
        return frame
    _check_alive(page, final=True)
    home = page.url
    frame = _find_form_after_click(page, visited)
    if frame:
        return frame
    candidates = _contact_links(page, home)
    external = [c for c in candidates if not _same_site(c, home)]
    root = f"{urlparse(home).scheme}://{urlparse(home).netloc}"
    for p in CONTACT_PATHS:  # adresses classiques en complément des liens trouvés
        if root + p not in candidates:
            candidates.append(root + p)
    tried: list[str] = []
    while candidates and len(tried) < 8:
        link = candidates.pop(0)
        if link in tried or time.monotonic() - started > SITE_BUDGET:
            continue
        tried.append(link)
        try:
            resp = page.goto(link, wait_until="domcontentloaded", timeout=timeout)
            if resp is not None and resp.status >= 400:
                continue
            visited.append((urlparse(link).path or "/") if _same_site(link, home) else urlparse(link).netloc)
            page.wait_for_timeout(1000)
            _dismiss_cookies(page)
            _scroll(page)
            harvest_emails(page, site, emails)
            frame = _find_form(page) or _find_form_late(page) or (
                _find_form_after_click(page, visited) if _same_site(link, home) else None)
            if frame:
                return frame
            # liens « contact » découverts sur cette page (ex. « Contactez-nous par mail ») : en priorité
            if _same_site(link, home):
                for extra in _contact_links(page, home):
                    if extra not in tried and extra not in candidates:
                        candidates.insert(0, extra)
                        if not _same_site(extra, home):
                            external.append(extra)
        except PWTimeout:
            continue
    if external:
        visited.append(f"formulaire externe non exploitable : {external[0][:80]}")
    return None


COOKIE_SELECTORS = [
    "#onetrust-accept-btn-handler", "#didomi-notice-agree-button", "#axeptio_btn_acceptAll",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", "#CybotCookiebotDialogBodyButtonAccept",
    ".cmplz-accept", ".cky-btn-accept", "#tarteaucitronPersonalize2", "#tarteaucitronAllAllowed", ".tarteaucitronAllow",
    ".iubenda-cs-accept-btn", ".qc-cmp2-summary-buttons button[mode=primary]", "a._brlbs-btn-accept-all",
    "#cookie_action_close_header", ".cc-allow", ".cc-accept", "#hs-eu-confirmation-button", ".sp_choice_type_11",
    "[data-cookiefirst-action=accept]", "#acceptAllCookies", "#accept-all-cookies", "#cookie-accept",
    "#usercentrics-root button[data-testid=uc-accept-all-button]", ".cmpboxbtnyes", "#BorlabsCookieBoxButtonAcceptAll",
]
COOKIE_ACCEPT = re.compile(r"^\W*(tout accepter|accepter|j'accepte|oui,? j'accepte|autoriser|d'accord|ok|compris|"
                           r"accept|accept all|allow all|agree|i agree|got it|alle akzeptieren|akzeptieren|zustimmen|"
                           r"aceptar|aceptar todo|accetta|accetta tutto|aceitar|alles accepteren|accepteren)\b[^\n]{0,30}$", re.I)


COOKIE_JS = r"""
(args) => {
  const qsa = (root, sel) => { const out = [...root.querySelectorAll(sel)];
    root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) out.push(...qsa(e.shadowRoot, sel)); }); return out; };
  const up = e => e.parentElement || (e.getRootNode() instanceof ShadowRoot ? e.getRootNode().host : null);
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    // coordonnées dans le document (la page a pu être déroulée) : un champ placé hors écran est un piège
    const left = r.left + scrollX, top = r.top + scrollY;
    return r.width > 2 && r.height > 2 && left + r.width > 0 && top + r.height > 0 && left < innerWidth * 2
      && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const labelFor = el => el.id ? (el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`) || null) : null;
  const [selectors, pattern] = args; const rx = new RegExp(pattern, 'i');
  for (const sel of selectors) for (const el of qsa(document, sel)) if (vis(el)) { el.click(); return sel; }
  for (const el of qsa(document, 'button, a, [role=button]')) {
    const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
    if (t && t.length < 60 && rx.test(t) && vis(el)) { el.click(); return t; }
  }
  return null;
}
"""
CONSENT_FRAME = re.compile(r"consent|cookie|privacy|cmp|didomi|onetrust|axeptio|usercentrics|sourcepoint|quantcast|iubenda"
                           r"|cookiebot|privacy-mgmt|cookielaw|trustarc|consentmanager", re.I)


def _dismiss_cookies(page: Page):
    """Accepte le bandeau cookies s'il y en a un : un seul appel au cadre principal puis aux cadres de
    consentement (jamais aux autres iframes, dont certaines ne répondent jamais)."""
    frames = [page.main_frame] + [f for f in page.frames if f != page.main_frame and CONSENT_FRAME.search(f.url or "")]
    for frame in frames[:4]:
        try:
            if frame.evaluate(COOKIE_JS, [COOKIE_SELECTORS, COOKIE_ACCEPT.pattern]):
                page.wait_for_timeout(600)
                return
        except Exception:
            continue


SET_VALUE_JS = """(e, v) => { e.focus(); e.value = v;
    ['input', 'change', 'blur'].forEach(t => e.dispatchEvent(new Event(t, {bubbles: true}))); return e.value === v; }"""
SELECT_TEXT_JS = """(e, v) => { const o = [...e.options].find(o => o.text.trim().toLowerCase() === v.trim().toLowerCase());
    if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('change', {bubbles: true})); return true; }"""


def _fill(loc, value: str):
    """Remplit un champ ; si le site bloque le remplissage normal (lenteur, widget), écrit la valeur directement."""
    try:
        loc.fill(value, timeout=5000)
    except Exception:
        if not loc.evaluate(SET_VALUE_JS, value):
            raise


def _select(loc, label: str):
    try:
        loc.select_option(label=label, timeout=3000)
    except Exception:
        if not loc.evaluate(SELECT_TEXT_JS, label):
            raise


def _check(loc):
    try:
        loc.check(timeout=2000, force=True)
    except Exception:
        loc.evaluate("""el => { el.click(); if (!el.checked) { el.checked = true;
            el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); } }""")


def _pick_country(opts: list[str], sender: Sender) -> str | None:
    names = [_norm(n).strip() for n in sender.country_names if n]
    for o in opts:
        if _norm(o).strip() in names:
            return o
    for o in opts:
        if any(_norm(o).strip().startswith(n) for n in names):
            return o
    return None


FILLABLE = {"email", "phone", "first_name", "last_name", "full_name", "company", "subject", "message", "website",
            "city", "zip", "address", "country", "civility", "job_title", "location"}


def _click_next(frame: Frame) -> bool:
    """Formulaire en plusieurs étapes : clique sur « Suivant » (jamais sur un bouton d'envoi)."""
    form = frame.locator("[data-ff-form]")
    cands = form.locator("button:visible, [role=button]:visible, input[type=button]:visible, a.button:visible, .btn:visible")
    for j in range(min(cands.count(), 8)):
        btn = cands.nth(j)
        try:
            label = _norm(btn.inner_text(timeout=500) or btn.get_attribute("value") or "")
            kind = (btn.get_attribute("type") or "").lower()
        except Exception:
            continue
        if NEXT_BUTTON.search(label) and not SUBMIT.search(label.replace("continuer", "")) or (kind == "button" and NEXT_BUTTON.search(label)):
            try:
                btn.click(timeout=3000)
            except Exception:
                try:
                    btn.evaluate("b => b.click()")
                except Exception:
                    continue
            frame.page.wait_for_timeout(1200)
            return True
    return False


def fill_form(frame: Frame, sender: Sender, subject: str, message: str, extra: dict | None = None,
              short_message: str = "") -> FillResult:
    """extra : valeurs saisies à la main pour des champs précis ({libellé du champ: valeur}).
    Les formulaires en plusieurs étapes sont parcourus : champs visibles remplis, « Suivant », et ainsi de suite."""
    res = FillResult(status="filled", form_url=frame.url)
    done: set[str] = set()  # identifiants (name/id/index) des champs déjà traités
    steps = 0
    while True:
        fields = frame.evaluate(DESCRIBE_JS)
        fresh = [f for f in fields if f["visible"] and _field_key(f) not in done]
        _fill_pass(frame, fields, fresh, sender, subject, message, extra, short_message, res)
        done.update(_field_key(f) for f in fresh)
        if res.status == "captcha":
            return res
        # champs utiles encore invisibles (étape suivante) → bouton « Suivant »
        remaining = [f for f in fields if not f["visible"] and f["type"] not in ("hidden", "submit", "button")
                     and classify(f) in FILLABLE and _field_key(f) not in done]
        steps += 1
        if not remaining or steps >= 5 or not _click_next(frame):
            break
        res.warnings.append("formulaire en plusieurs étapes") if steps == 1 else None
    return _finish(frame, fields, sender, res)


def _field_key(f: dict) -> str:
    return f["name"] or f["id"] or f"{f['tag']}:{f['label']}:{f['i']}"


def _finish(frame: Frame, fields: list[dict], sender: Sender, res: FillResult) -> FillResult:
    civ_rx = _civ_regex(sender)
    try:
        check = frame.evaluate(VALIDATE_JS, {"countries": sender.country_names,
                                             "civility": civ_rx.pattern if civ_rx else None})
    except Exception:
        check = {"invalid": [], "truncated": 0}
    by_i = {f["i"]: f for f in fields}
    for i in check["invalid"]:
        f = by_i.get(i)
        label = f and (f["label"] or f["placeholder"] or f["name"] or f["id"])
        if f and f["visible"] and label not in res.missing:
            res.missing.append(label)
            res.warnings.append(f"refusé par le formulaire : {label}")
    if check["truncated"]:
        res.warnings.append(f"message coupé à {check['truncated']} caractères par le site : raccourcissez-le")
    if "message" not in res.filled:
        res.warnings.append("pas de zone de message sur ce formulaire : seuls vos coordonnées et l'objet partiront")
    if "email" not in res.filled and "phone" not in res.filled:
        res.warnings.append("pas de champ email ni téléphone : l'entreprise ne pourra pas vous répondre")
    res.warnings = list(dict.fromkeys(w for w in res.warnings if w))
    return res


def _fill_pass(frame: Frame, fields: list[dict], fresh: list[dict], sender: Sender, subject: str, message: str,
               extra: dict | None, short_message: str, res: FillResult) -> None:
    values = _values(sender, subject, message)
    civ_rx = _civ_regex(sender)
    if any(f.get("captchaImg") for f in fields[:1]):
        res.status, res.protection, res.detail = "captcha", "image", "captcha image dans le formulaire"
    else:
        for f in fields:
            if f["visible"] and CAPTCHA_TEXT.search(_norm(f["label"] + " " + f["name"])):
                res.status = "captcha"
                res.protection = "math" if MATH_TEXT.search(_norm(f["label"])) else "text"
                res.detail = f"captcha à recopier : « {f['label'][:60]} »"
                break
    has_message = "message" in res.filled
    radios_done: set[str] = set()
    civ_radio = {f["name"]: f["i"] for f in fields if f["type"] == "radio" and f["name"] and civ_rx and civ_rx.search(f["label"] or "")}
    kinds = {f["i"]: classify(f) for f in fresh}
    lone_name = "last_name" in kinds.values() and "first_name" not in kinds.values()
    # Un seul champ texte libre sans zone de message : il reçoit le message (formulaires « rappel »)
    for f in fresh:
        kind = kinds[f["i"]]
        if kind == "last_name" and lone_name:
            kind = "full_name"
        if kind is None or HONEYPOT.search(f["name"] or "") or HONEYPOT.search(f["id"] or ""):
            continue
        loc = frame.locator(f'[data-ff-i="{f["i"]}"]')
        label = f["label"] or f["placeholder"] or f["name"] or f["id"]
        try:
            if extra and extra.get(label, "").strip():
                if f["type"] in ("checkbox", "radio"):
                    if _norm(extra[label]).strip() in ("oui", "yes", "coche", "x", "true", "ok", "ja", "si"):
                        _check(loc)
                elif kind == "select":
                    _select(loc, extra[label])
                else:
                    _fill(loc, extra[label])
                res.filled[f"saisi {f['i']}"] = label
            elif kind == "checkbox":
                text = _norm(f"{f['label']} {f['name']}")
                if CONSENT.search(text) and not NEWSLETTER.search(text):
                    _check(loc)
                    res.filled["consentement"] = label
                elif f["required"] and not NEWSLETTER.search(text):
                    _check(loc)
                    res.filled[f"case obligatoire {f['i']}"] = label
            elif kind == "radio" and f["name"] in civ_radio:
                if f["i"] == civ_radio[f["name"]]:
                    _check(loc)
                    radios_done.add(f["name"])
                    res.filled["civilité"] = f"{label}"
            elif kind == "radio":
                if f["name"] not in radios_done and f["required"]:
                    _check(loc)
                    radios_done.add(f["name"])
            elif kind == "select":
                opts = [o for o in f["options"] if o and not re.search(r"^(--|choisi|select|s[eé]lection|veuillez|bitte|elige|seleccion|scegli|kies)", _norm(o))]
                pick = next((o for o in opts if SELECT_PREF.search(_norm(o))), opts[0] if opts else None)
                country = _pick_country(opts, sender)
                if country and (re.search(COUNTRY, _norm(f"{label} {f['name']}")) or len(opts) > 20):
                    pick = country
                elif civ_rx and (re.search(CIVILITY, _norm(f"{label} {f['name']}")) or any(CIV_F.search(o) or CIV_M.search(o) for o in opts)):
                    pick = next((o for o in opts if civ_rx.search(o)), pick)
                if pick:
                    _select(loc, pick)
                    res.filled[f"liste {f['i']}"] = f"{label} = {pick}"
            elif kind == "unknown":
                if CAPTCHA_TEXT.search(_norm(label)):
                    continue
                if not has_message and f["type"] in ("text", "") and f["tag"] == "input" and not any(
                        k == "message" for k in kinds.values()) and f["required"]:
                    _fill(loc, values["message"])
                    has_message = True
                    res.filled["message"] = label
                    res.warnings.append(f"message écrit dans le champ « {label} » (pas de zone de message)")
                    continue
                if f["required"]:
                    res.warnings.append(f"champ obligatoire non reconnu : {label}")
                    res.missing.append(label)
            else:
                value = values.get(kind, "")
                if not value:
                    if f["required"]:
                        res.warnings.append(f"champ obligatoire vide dans votre profil : {label}")
                        res.missing.append(label)
                    continue
                if kind == "message":
                    if has_message:
                        continue
                    has_message = True
                    limit = loc.evaluate("e => e.maxLength || 0")
                    if short_message and 0 < limit < len(value) and len(short_message) < len(value):
                        value, res.short = short_message, True
                if f["type"] == "number":
                    value = re.sub(r"\D", "", value)
                _fill(loc, value)
                res.filled[kind] = label
        except Exception as e:  # champ non modifiable, masqué par un widget…
            if f["required"]:
                res.warnings.append(f"champ impossible à remplir : {label} ({type(e).__name__})")
                res.missing.append(label)


def detect_protection(frame: Frame) -> str | None:
    """Type de protection visible (reCAPTCHA case à cocher, hCaptcha, Turnstile…), ou None."""
    for kind, selector in PROTECTIONS:
        try:
            if frame.locator(selector).count() > 0 or frame.page.locator(selector).count() > 0:
                return kind
        except Exception:
            continue
    return None


def submit(frame: Frame) -> tuple[bool | None, str]:
    """Clique sur le bouton d'envoi du formulaire et vérifie la confirmation (None = refusé par le site)."""
    _dismiss_cookies(frame.page)
    form = frame.locator("[data-ff-form]")
    btn = form.locator('button[type="submit"]:visible, input[type="submit"]:visible, button:not([type]):visible')
    if not btn.count():
        cands = form.locator("button:visible, [role=button]:visible, a.button:visible, input[type=button]:visible")
        btn = cands.filter(has_text=SUBMIT) if cands.count() else cands
    url_before = frame.url
    if btn.count():
        try:
            btn.first.click(timeout=5000)
        except Exception:
            btn.first.evaluate("b => b.click()")
    elif not frame.evaluate("() => {" + QSA_JS + """ const f = qsa(document, '[data-ff-form]')[0];
                                      if (f && f.tagName === 'FORM' && f.requestSubmit) { f.requestSubmit(); return true; }
                                      return false; }"""):
        return False, "bouton d'envoi introuvable"
    frame.page.wait_for_timeout(5000)
    try:
        text = _norm(frame.page.inner_text("body", timeout=5000))
    except Exception:
        text = ""
    m = FAILURE.search(text)
    if m:
        return None, f"refusé par le site (« {m.group(0)} »)"
    if SUCCESS.search(text):
        return True, "confirmation affichée"
    if frame.url != url_before:
        return True, "page changée après envoi"
    try:
        if not form.count() or not form.first.is_visible():
            return True, "formulaire disparu après envoi"
    except Exception:
        pass
    return False, "pas de confirmation visible"
