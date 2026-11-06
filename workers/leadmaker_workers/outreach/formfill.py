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
from urllib.parse import unquote, urlparse

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
    ("phone", r"\bt[eé]l|phone|portable|mobile|gsm|joindre|telefon|handy|mobil|cellulare|telemovel|celular"),
    ("phone", r"^(?!.*(siret|siren|tva|commande|order|dossier|serie|suivi|contrat|client|facture|locataire|adherent|membre"
              r"|rue|voie|voirie|maison|street|departement|immat|reservation|carte|adeli|rpps|\brg\b|redevable"
              r"|appartement|ligne|licence|permis|securite sociale|kunden|rechnung|bestell|pedido|ordine)).*(\bnumero\b|\bn°|\bnumber\b|\bnummer\b)"),
    ("full_name", r"nom ?(et|&|/|,) ?pr[eé]nom|pr[eé]nom ?(et|&|/|,) ?nom|vos nom et|nom complet|full ?name|vor- und nachname|nombre completo|nome completo"),
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
# Case OBLIGATOIRE : on la coche sauf si c'est vraiment une inscription (lettre d'info, offres, partenaires…).
# « J'accepte d'être recontacté au sujet de ma demande » bloquait l'envoi (5/11/2026 : 7 formulaires sur 500).
NEWSLETTER_STRICT = re.compile(r"newsletter|lettre d'information|actualit|offres? (commerciales|promotionnelles)|partenaires"
                               r"|marketing|promotion|special offers|subscribe|mailing list|receive (updates|news|offers)"
                               r"|werbung|boletin|novedades|nieuwsbrief", re.I)
# Captchas « à recopier » (image, calcul)
CAPTCHA_TEXT = re.compile(r"code de securite|entre[rz]? le code|recopie|antispam|anti-spam|combien font|resultat de l'operation"
                          r"|(?<!re)captcha|security code|enter the (code|characters)|what is \d+|solve|math question"
                          r"|prove you|sicherheitscode|rechenaufgabe|codigo de seguridad|codice di sicurezza", re.I)
MATH_TEXT = re.compile(r"combien font|resultat de l'operation|what is \d+|math question|rechenaufgabe|\d+\s*[+×x*-]\s*\d+\s*=", re.I)
CONTACT_PATHS = ["/contact", "/contact-us", "/contact/", "/contact-us/", "/contactus", "/contact.html", "/contact-us.html",
                 "/contact.php", "/nous-contacter", "/kontakt", "/kontakt/", "/contacto", "/contacto/", "/contatti",
                 "/contatti/", "/contato", "/get-in-touch"]
# Listes déroulantes et boutons radio (6/11/2026 : « Demande de devis / tarifs » choisi sur ~70 formulaires, les
# entreprises croyaient recevoir une demande de client). Jamais ces choix-là ; parmi les autres, l'ordre de préférence.
OPTION_AVOID = re.compile(r"devis|tarif|\bprix\b|price|pricing|quote|estimation|chiffrage|rendez|\brdv\b|appointment"
                          r"|commande|\border\b|reserv|booking|\bsav\b|apres[- ]?vente|after[- ]?sales|reclamation|complaint"
                          r"|litige|candidature|emploi|recrutement|\bjob\b|career|carriere|particulier|\bprive\b|private"
                          r"|individual|urgence|urgent|depannage|remboursement|\bachat\b|acheter|\bbuy\b"
                          r"|angebot|presupuesto|preventivo|orcamento|offerte|\bcita\b|termin\b", re.I)
OPTION_PREFS = [re.compile(p, re.I) for p in (
    r"partenariat|partnership|partner|kooperation|colaboracion|collaborazione",
    r"prospection|fournisseur|supplier|prestataire|vendor",
    r"commercial|business|sales",
    r"information|renseignement|\binfos?\b|question|inquiry|enquiry",
    r"contact|general",
    r"autre|other|divers|sonstige|otro|altro|anders|outro",
    r"professionnel|professional|entreprise|company|societe|\bpro\b|\bb2b\b",
)]
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
# Formulaires de DEVIS / réservation / rendez-vous / commande : jamais remplis (6/11/2026 : 73 sur 314 envoyés,
# les entreprises rappelaient en croyant à un client). Le robot cherche un vrai formulaire de contact ailleurs.
# Textes comparés sans accents et en minuscules ; motifs écrits pour Python ET JavaScript.
# 1) adresse de la page (/devis, /demande-de-devis, /rendez-vous…), même « /devis-contact »
QUOTE_URL = re.compile(r"(^|[/_.-])(devis|demande-de-devis|quote|get-a-quote|request-a-quote|free-quote|estimate|estimation"
                       r"|rendez-vous|rdv|prise-de-rendez-vous|reservation|reserver|booking|book-online|appointment"
                       r"|commande|commander|order|angebot|presupuesto|preventivo|orcamento|offerte)([/_.-]|$)", re.I)
# 2) titre du formulaire, titre juste au-dessus ou bouton d'envoi (« Devis gratuit », « Prendre rendez-vous »…) ;
#    même mixte (« Devis / Contact ») : l'entreprise lit la demande comme celle d'un client
QUOTE_TITLE = re.compile(r"devis|estimation|chiffrage|rendez-?vous|\brdv\b|reserv(er|ez|ation)|\bbook(ing)?\b"
                         r"|\bcommande[rz]?\b|\bquote\b|estimate|appointment|angebot|kostenvoranschlag|terminvereinbarung"
                         r"|presupuesto|\bcita\b|preventivo|prenota|orcamento|offerte"
                         r"|demande d'intervention|demander une intervention|request an? (\w+ )?(locksmith|technician|plumber"
                         r"|electrician|service|callback|call back|visit)|schedule (a |an )?(service|visit|call)|\bbook (a|an|now|your)\b", re.I)
# 3) champs typiques d'un projet de client
QUOTE_FIELD = re.compile(
    r"type (de |d'|du |des )?(travaux|prestation|projet|chantier|bien|batiment|logement|intervention|toiture|produit)"
    r"|nature (des|du) (travaux|projet|chantier)|travaux (a realiser|souhaites?|demandes?|envisages?)"
    r"|prestations? (souhaitees?|demandees?)|\bsurface\b|superficie|\bm2\b|\bbudget\b"
    r"|(adresse|ville|commune|lieu|code postal|localisation)[^,;:*]{0,12}(du|des|de votre|de l'|de la|d') ?(chantier|travaux|intervention)"
    r"|\bdimensions?\b|\bvos mesures\b|\bmesures (de|du|des)\b|deplacement|quantite|\bservices? (souhaites?|demandes?)"
    r"|(decri|description|details?|parlez|dites)[^.?!]{0,25}projet|votre projet en quelques mots|quel est votre projet"
    r"|decrivez votre (panne|probleme)|quand (vous|souhaitez-vous etre|pouvons-nous vous) rappel|creneau|quel jour"
    r"|date (souhaitee|de votre projet|du projet|d'intervention|de debut|des travaux|de l'evenement|de livraison|d'arrivee"
    r"|de reservation)|niveau d'urgence|delai (souhaite|de realisation)|nombre de (personnes|couverts|invites|participants|nuits)"
    r"|(parlez|decri|details?|dites)[^.?!]{0,25}(evenement|mariage|soiree|fete|reception)|votre evenement"
    r"|scope of work|service (needed|required|requested)|tell us about your (event|project)|event (date|type)"
    r"|devis|estimation (gratuite|de votre projet|du projet)|project type|type of (work|project|service)|square (feet|footage|meters)|your budget"
    r"|project (address|description|details)|describe your project|preferred (date|time)|best time to call", re.I)
QUOTE_DETAIL = "formulaire de devis, pas de formulaire de contact"
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
#
# Les formulaires de devis / réservation (titre, bouton d'envoi ou champs « projet », motifs QUOTE_*) ne sont jamais
# retenus : la raison du refus est renvoyée dans `quote`. Résultat : {score, quote} (score 0 = rien de retenu).
FIND_FORM_JS = r"""
(rx) => {
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
  // --- formulaire de devis / réservation ? (textes sans accents, minuscules)
  const N = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\[\]]+/g, ' ')
    .replace(/\s+/g, ' ').toLowerCase().trim();
  const TITLE = new RegExp(rx.title, 'i'), QFIELD = new RegExp(rx.field, 'i');
  // libellé d'un champ, sans le texte des choix d'une liste (« Votre demande : Devis / Question » n'est pas un devis)
  const fieldLabel = e => {
    let t = [e.name, e.id, e.placeholder, e.getAttribute('aria-label'), (labelFor(e) || {}).innerText].join(' ');
    const l = e.closest('label');
    if (l) { let lt = l.innerText || ''; if (e.tagName === 'SELECT') [...e.options].forEach(o => { lt = lt.replace(o.text, ' '); }); t += ' ' + lt; }
    // libellé non relié au champ : texte voisin (2 niveaux au-dessus), comme DESCRIBE_JS
    if (!labelFor(e) && !l && !e.getAttribute('aria-label')) {
      let p = up(e);
      for (let i = 0; i < 2 && p; i++, p = up(p)) {
        const txt = [...p.childNodes].filter(n => n.nodeType === 3 || ['LABEL', 'SPAN', 'P', 'DIV', 'LEGEND', 'STRONG', 'B'].includes(n.tagName))
          .filter(n => !(n.querySelector && n.querySelector('input,textarea,select'))).map(n => n.textContent || '').join(' ').trim();
        if (txt && txt.length < 120) { t += ' ' + txt; break; }
      }
    }
    return N(t);
  };
  const HSEL = 'h1,h2,h3,h4,h5,h6,legend,[role=heading],[class*="title" i],[class*="heading" i]';
  // un titre mixte (« Devis / Contact ») est un devis : l'entreprise lit la demande comme celle d'un client
  const isTitle = h => { const t = N(h.innerText || h.value || ''); return t && t.length < 120 && TITLE.test(t) ? t : ''; };
  // titres de la page, dans l'ordre du document : le dernier placé avant le formulaire est son titre de section,
  // même loin au-dessus (« Obtenir un devis » puis le formulaire, couvreur-marseille.com)
  const HEADS = qsa(document, 'h1,h2,h3,h4,h5,h6,[role=heading]').filter(h => N(h.innerText).length > 1);
  const headBefore = f => { let last = null;
    for (const h of HEADS) { if (f.contains(h)) continue;
      const pos = h.compareDocumentPosition(f);
      if (pos & Node.DOCUMENT_POSITION_DISCONNECTED) continue;
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) last = h; else break; }
    return last; };
  const quoteOf = (f, fields) => {
    for (const e of fields) { const t = fieldLabel(e); const m = t.match(QFIELD); if (m) return `champ « ${t.slice(0, 50)} »`; }
    for (const h of qsa(f, HSEL)) { const t = isTitle(h); if (t) return `titre « ${t.slice(0, 50)} »`; }
    for (const b of qsa(f, 'button, input[type=submit], [role=button]')) { const t = isTitle(b); if (t) return `bouton « ${t.slice(0, 50)} »`; }
    // petits textes d'en-tête écrits dans le formulaire (« DEVIS GRATUIT », <p>Demandez votre devis</p>), hors
    // libellés, listes, boutons et liens
    const walker = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let node = walker.nextNode(), k = 0; node && k < 200; node = walker.nextNode(), k++) {
      const p = node.parentElement;
      if (!p || seen.has(p) || !node.textContent.trim() || p.closest('label,select,option,button,textarea,a,script,style,noscript,li,[role=option],[role=listbox]')) continue;
      // un bloc qui contient un champ ou une liste maison (« Objet : Prise de rendez-vous / Information… ») n'est pas un titre
      if (p.querySelector('input,select,textarea,li,[role=option]')) continue;
      seen.add(p);
      const t = isTitle(p); if (t) return `titre « ${t.slice(0, 50)} »`;
    }
    // titre placé juste au-dessus du formulaire (l'élément précédent, sur 3 niveaux ; plus loin, c'est souvent
    // un autre bloc de la page : silvera.fr, onglets « Nous contacter / Demander un devis »)
    let n = f;
    for (let lvl = 0; lvl < 3 && n && !isRoot(n); lvl++, n = up(n)) {
      const s = n.previousElementSibling;
      if (!s) continue;
      const h = s.matches(HSEL) ? s : [...s.querySelectorAll(HSEL)].pop();
      if (h && N(h.innerText)) { const t = isTitle(h); if (t) return `titre « ${t.slice(0, 50)} »`; break; }
      if (N(s.innerText)) break;
    }
    const hb = headBefore(f);
    if (hb) { const t = isTitle(hb); if (t) return `titre de la section « ${t.slice(0, 50)} »`; }
    return null;
  };
  let best = -1, bestScore = 0, quote = null;
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
    // sans zone de message : demande de rappel (nom + téléphone, l'entreprise rappellerait en croyant à un client,
    // 6/11/2026 tapissier-75.fr…) ou lettre d'info. Jamais retenu.
    if (!msg) return;
    const q = quoteOf(f, fields);
    if (q) { quote = quote || q; return; }
    const score = (ta ? 5 : 0) + (msg ? 3 : 0) + (reply ? 3 : 0) + Math.min(fields.length, 8) + (visible ? 2 : 0) - (f.tagName === 'FORM' ? 0 : 2);
    if (score > bestScore) { best = i; bestScore = score; }
  });
  containers.forEach(f => f.removeAttribute('data-ff-form'));
  // une page qui porte un formulaire de devis : aucun de ses formulaires n'est rempli (le second est souvent le même
  // devis en bas de page, alainrenovation.com) ; le robot cherche une vraie page contact ailleurs
  if (quote) return {score: 0, quote};
  if (best < 0) return null;
  containers[best].setAttribute('data-ff-form', '1');
  return {score: bestScore, quote};
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
  // même règle que pick_option (Python) : jamais devis, rendez-vous, particulier… ; ordre de préférence ensuite
  const N = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const avoid = new RegExp(prefs.avoid, 'i'), order = (prefs.order || []).map(p => new RegExp(p, 'i'));
  const choose = items => { const ok = items.filter(x => !avoid.test(N(x.text)));
    for (const p of order) { const x = ok.find(x => p.test(N(x.text))); if (x) return x; } return null; };
  const radioText = r => { const l = labelFor(r) || r.closest('label'); return (l && l.innerText) || r.value || ''; };
  for (const el of els) {
    if (el.checkValidity()) continue;
    if (el.tagName === 'SELECT') {
      const ok = [...el.options].filter(o => o.value && !o.disabled);
      const o = ok.find(o => countries.includes(o.text.trim().toLowerCase()))
        || (civ && ok.find(o => civ.test(o.text))) || (choose(ok.map(o => ({o, text: o.text}))) || {}).o;
      if (o) { el.value = o.value; fire(el); }
    } else if (el.type === 'radio' && el.name) {
      const group = qsa(form, `input[type=radio][name="${CSS.escape(el.name)}"]`);
      const r = (civ && group.find(r => civ.test(radioText(r).trim()))) || (choose(group.map(r => ({r, text: radioText(r)}))) || {}).r;
      if (r) { r.checked = true; fire(r); }
    }
  }
  const ta = qsa(form, 'textarea').find(t => t.maxLength > 0 && t.value.length >= t.maxLength);
  return {invalid: els.filter(el => !el.checkValidity()).map(el => +el.dataset.ffI), truncated: ta ? ta.maxLength : 0};
}
"""

EMAILS_JS = "() => {" + QSA_JS + r"""
  const out = [];
  qsa(document, 'a[href^="mailto:"]').forEach(a => out.push(decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0])));
  // protection Cloudflare : adresse chiffrée dans data-cfemail
  qsa(document, '[data-cfemail]').forEach(el => { const h = el.getAttribute('data-cfemail'); const k = parseInt(h.slice(0, 2), 16);
    let e = ''; for (let i = 2; i < h.length; i += 2) e += String.fromCharCode(parseInt(h.slice(i, i + 2), 16) ^ k); out.push(e); });
  out.push(document.body ? document.body.innerText : '');
  return out.join('\n');
}
"""
# adresses écrites « contact [at] site [dot] fr » ou « contact (arobase) site (point) fr »
OBFUSCATED_AT = re.compile(r"\s*[\[\(\{]\s*(at|arobase|@)\s*[\]\)\}]\s*", re.I)
OBFUSCATED_DOT = re.compile(r"\s*[\[\(\{]\s*(dot|point)\s*[\]\)\}]\s*", re.I)


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
    # un libellé visible qui ne correspond à rien de connu (« Dimensions de tapis ») : jamais rempli au hasard, même si
    # le site a mis autocomplete="name" ou name="nom" sur le champ (6/11/2026 tapisdecovincennes.com)
    label = _norm(f["label"] or "")
    # libellé qui est en fait la phrase de consentement voisine (« J'autorise l'Atelier… ») : ignoré, le texte d'aide du
    # champ (« Vos nom et prénom ») fait foi (6/11/2026 latelierdespotiersheureux.fr : le téléphone écrit dans le nom)
    if len(label) > 40 and (CONSENT.search(label) or re.search(r"autoris|coordonnees|recevoir|newsletter|informations? (commerciales|par)", label)):
        f = {**f, "label": ""}
        label = ""
    if len(re.sub(r"[^a-z]", "", label)) >= 3 and not any(re.search(p, label) for _, p in FIELD_RULES):
        return "unknown"
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


# Jamais « Particulier », « Devis », « Rendez-vous » : ces boutons ouvrent des demandes de client (6/11/2026)
REVEAL_BUTTON = re.compile(r"contact|message|ecrire|get in touch|inquir|kontakt|anfrage|contacto|contatt|choisir", re.I)
REVEAL_AVOID = NOT_CONTACT.pattern + "|" + QUOTE_TITLE.pattern + "|particulier"
REVEAL_JS = "(args) => {" + QSA_JS + r"""
  const [pattern, notPattern] = args; const rx = new RegExp(pattern, 'i'), bad = new RegExp(notPattern, 'i');
  const cands = qsa(document, 'button, [role=button], a[href="#"], a[href^="#"], a[href^="javascript"], a:not([href]), [data-toggle], [data-popup], [data-elementor-open-popup], .elementor-button')
    .filter(el => vis(el) && !/^(tel:|mailto:)/i.test(el.getAttribute('href') || ''));
  for (const el of cands) {
    const t = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
    const n = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (t && t.length < 50 && rx.test(n) && !bad.test(n)) { el.scrollIntoView({block: 'center'}); el.click(); return t; }
  }
  return null;
}
"""


def _click_reveal(page: Page) -> str | None:
    """Clique sur un bouton qui semble ouvrir le formulaire (fenêtre, assistant « particulier / professionnel »)."""
    try:
        return page.main_frame.evaluate(REVEAL_JS, [REVEAL_BUTTON.pattern, REVEAL_AVOID])
    except Exception:
        return None


def _find_form_after_click(page: Page, visited: list[str], quotes: list | None = None) -> Frame | None:
    """Sans formulaire visible : un clic sur un bouton « contact / écrire » peut l'afficher."""
    label = _click_reveal(page)
    if not label:
        return None
    page.wait_for_timeout(1500)
    visited.append(f"clic « {label[:30]} »")
    frame = _find_form(page, quotes)
    if frame:
        return frame
    # assistant en deux temps
    label = _click_reveal(page)
    if label:
        page.wait_for_timeout(1500)
        visited.append(f"clic « {label[:30]} »")
        return _find_form(page, quotes)
    return None


def quote_url(url: str) -> str | None:
    """Chemin de la page s'il désigne une page de devis / réservation / rendez-vous (même « /contact-devis »)."""
    path = _norm(unquote(urlparse(url or "").path))
    return path if QUOTE_URL.search(path) else None


QUOTE_ARGS = {"title": QUOTE_TITLE.pattern, "field": QUOTE_FIELD.pattern}


def _find_form(page: Page, quotes: list | None = None) -> Frame | None:
    """Cadre qui contient un formulaire de contact, ou None. Les formulaires de devis vus en chemin sont notés dans
    `quotes` (adresse de la page, raison)."""
    quotes = quotes if quotes is not None else []
    page_quote = quote_url(page.url)
    # cadres sans adresse : jamais chargés (ou détachés), ils ne répondent pas aux appels
    frames = [page.main_frame] + [f for f in page.frames if f != page.main_frame and f.url and not SKIP_FRAME.search(f.url)]
    for frame in frames[:12]:
        try:
            r = frame.evaluate(FIND_FORM_JS, QUOTE_ARGS)
        except Exception:
            continue
        if not r:
            continue
        if r.get("quote"):
            quotes.append((page.url, r["quote"]))
        if r.get("score"):
            fq = page_quote or (quote_url(frame.url) if frame != page.main_frame else None)
            if fq:
                quotes.append((page.url, f"page « {fq} »"))
                continue
            return frame
    return None


def _contact_links(page: Page, base: str, skipped: list | None = None) -> list[str]:
    """Liens « contact » du site, les meilleurs d'abord. Les liens vers une page de devis sont écartés (notés dans
    `skipped`)."""
    # liens <a> dans un dessin SVG : a.href n'y est pas un texte (objet SVGAnimatedString) → adresse relue à la main
    # (5/11/2026 : kimonoya.fr classé « site inaccessible » à cause de ça)
    links = page.evaluate("""() => [...document.querySelectorAll('a[href]')].map(a => {
        let href = a.href;
        if (typeof href !== 'string') { try { href = new URL(a.getAttribute('href'), document.baseURI).href; } catch (e) { href = ''; } }
        return [href, (a.innerText || a.title || a.getAttribute('aria-label') || '').trim()];
    })""")
    scored = []
    for href, text in links:
        if not isinstance(href, str) or not href.startswith("http"):
            continue
        if not _same_site(href, base):
            if FORM_SERVICES.search(href):  # formulaire hébergé ailleurs : essayé après les pages du site
                scored.append((0, href))
            continue
        t = _norm(f"{text} {urlparse(href).path}")
        if quote_url(href):  # page de devis / rendez-vous : son formulaire serait refusé, inutile d'y aller
            if skipped is not None and CONTACT_LINK.search(t):
                skipped.append(href)
            continue
        if CONTACT_LINK.search(t) and not NOT_CONTACT.search(t):
            # « Devis gratuit » qui mène à /contact : essayé, mais après les vrais liens « contact »
            score = 2 if re.search(r"contact|kontakt|contatt|contato", t) else 0.5 if QUOTE_TITLE.search(t) else 1
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


def _find_form_late(page: Page, quotes: list | None = None) -> Frame | None:
    """Formulaires chargés après coup (Jotform, HubSpot, composants web…) : 2 s de plus."""
    page.wait_for_timeout(2000)
    return _find_form(page, quotes)


def harvest_emails(page: Page, site: str, found, where: str = "other") -> None:
    """Relève les adresses e-mail visibles (liens mailto, texte, adresses masquées). `found` est un ensemble,
    ou un dictionnaire adresse -> pages où elle apparaît (accueil, contact, legal, other)."""
    try:
        text = page.evaluate(EMAILS_JS)
    except Exception:
        return
    text = OBFUSCATED_DOT.sub(".", OBFUSCATED_AT.sub("@", text or ""))
    for m in EMAIL.findall(text):
        if EMAIL_SKIP.search(m):
            continue
        if isinstance(found, dict):
            found.setdefault(m.lower(), set()).add(where)
        else:
            found.add(m.lower())


def _host(site: str) -> str:
    return (urlparse(site if "://" in site else f"http://{site}").hostname or "").removeprefix("www.").lower()


def _tokens(text: str) -> set[str]:
    """Mots significatifs d'un nom de domaine ou d'une raison sociale (≥ 4 lettres, sans accents)."""
    stop = {"plomberie", "plombier", "electricite", "electricien", "chauffage", "renovation", "services", "service",
            "entreprise", "societe", "groupe", "group", "france", "lyon", "paris", "sarl", "sas", "eurl", "contact",
            "info", "mail", "email", "gmail", "hotmail", "orange", "free", "wanadoo", "outlook", "yahoo", "icloud"}
    words = re.split(r"[^a-z0-9]+", _norm(text))
    return {w for w in words if len(w) >= 4 and w not in stop and not w.isdigit()}


def own_email(site: str, found) -> str | None:
    """Adresse au domaine du site (la plus sûre), ou None."""
    host = _host(site)
    root = ".".join(host.split(".")[-2:])
    same = sorted(e for e in found if e.endswith("@" + host) or e.endswith("." + root) or e.endswith("@" + root))
    return same[0] if same else None


# Domaines d'agences web, plateformes et annuaires : une adresse chez eux n'est jamais celle de l'entreprise
THIRD_PARTY = re.compile(r"agence|agency|webdesign|web-?design|digital|studio|creation|communication|marketing|seo\b"
                         r"|forumconstruire|viteundevis|solocal|pagesjaunes|wix|godaddy|ovh|ionos|1and1|squarespace|jimdo"
                         r"|webflow|houzz|yelp|facebook|google|wordpress|shopify|hostinger|o2switch|infomaniak|gandi"
                         r"|site-solocal|e-monsite|weebly|strikingly|cloudflare|sentry|hubspot|mailchimp|sendinblue|brevo", re.I)


def related_email(site: str, found, name: str = "") -> str | None:
    """Adresse à un autre domaine, mais apparenté au site ou au nom de l'entreprise (ex. contact@klai.fr pour
    klai-peinture.fr), ou None."""
    host = _host(site)
    keys = _tokens(host) | _tokens(name)
    if not keys:
        return None
    for e in sorted(found):
        local, _, domain = e.partition("@")
        if THIRD_PARTY.search(domain):
            continue
        if _tokens(domain) & keys or _tokens(local) & keys:
            return e
    return None


def plausible_email(found) -> str | None:
    """Adresse vue sur une page contact ou mentions légales du site, hors plateformes connues (dictionnaire seul)."""
    if not isinstance(found, dict):
        return None
    for e in sorted(found):
        domain = e.partition("@")[2]
        if found[e] & {"contact", "legal"} and not THIRD_PARTY.search(domain):
            return e
    return None


# Messageries grand public : une adresse chez elles appartient plausiblement à l'entreprise. Une adresse au
# domaine d'une autre société (annuaire, agence web, plateforme) n'est jamais retenue.
WEBMAIL = re.compile(r"@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm"
                     r"|gmx|web|mail|orange|wanadoo|free|sfr|neuf|laposte|bbox|numericable|club-internet|aliceadsl"
                     r"|t-online|freenet|libero|virgilio|tiscali|telenet|skynet|ziggo|kpn|btinternet|sky|comcast|att"
                     r"|verizon|bell|rogers|videotron|uol|bol|terra)\.[a-z.]+$", re.I)


def best_email(site: str, found, name: str = "") -> str | None:
    """Adresse à retenir : domaine du site, sinon domaine apparenté (site ou raison sociale), sinon messagerie
    grand public, sinon adresse vue sur une page contact / mentions légales hors plateformes, sinon rien."""
    own = own_email(site, found)
    if own:
        return own
    related = related_email(site, found, name)
    if related:
        return related
    webmail = sorted(e for e in found if WEBMAIL.search(e))
    if webmail:
        return webmail[0]
    return plausible_email(found)


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
                      visited: list[str] | None = None, quotes: list | None = None) -> Frame | None:
    """Ouvre le site et renvoie le cadre contenant le formulaire de contact (ou None).
    `visited` reçoit les pages explorées (pour expliquer un échec), `quotes` les formulaires de devis écartés
    (adresse de la page, raison)."""
    emails = emails if emails is not None else set()
    visited = visited if visited is not None else []
    quotes = quotes if quotes is not None else []
    started = time.monotonic()
    _load(page, site, timeout)
    _check_alive(page)
    visited.append("accueil")
    harvest_emails(page, site, emails)
    frame = _find_form(page, quotes) or _find_form_late(page, quotes)
    if frame:
        return frame
    _check_alive(page, final=True)
    home = page.url
    frame = _find_form_after_click(page, visited, quotes)
    if frame:
        return frame
    skipped: list[str] = []  # liens vers des pages de devis, jamais ouverts
    candidates = _contact_links(page, home, skipped)
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
            frame = _find_form(page, quotes) or _find_form_late(page, quotes) or (
                _find_form_after_click(page, visited, quotes) if _same_site(link, home) else None)
            if frame:
                return frame
            # liens « contact » découverts sur cette page (ex. « Contactez-nous par mail ») : en priorité
            if _same_site(link, home):
                for extra in _contact_links(page, home, skipped):
                    if extra not in tried and extra not in candidates:
                        candidates.insert(0, extra)
                        if not _same_site(extra, home):
                            external.append(extra)
        except PWTimeout:
            continue
    if external:
        visited.append(f"formulaire externe non exploitable : {external[0][:80]}")
    if skipped and not quotes:
        quotes.append((skipped[0], f"lien vers la page de devis « {quote_url(skipped[0])} »"))
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


def pick_option(opts: list[str]) -> str | None:
    """Choix d'une liste ou d'un groupe de boutons radio : jamais devis, tarif, rendez-vous, commande, SAV, candidature,
    particulier… ; parmi les autres, partenariat > prospection > commercial > information > contact > autre >
    professionnel. None si aucun choix ne convient (jamais un choix au hasard comme « Installation » ou
    « Déplacement : oui ») : la liste est laissée telle quelle, et si elle est obligatoire le formulaire est à compléter."""
    allowed = [o for o in opts if not OPTION_AVOID.search(_norm(o))]
    for pref in OPTION_PREFS:
        for o in allowed:
            if pref.search(_norm(o)):
                return o
    return None


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
                                             "civility": civ_rx.pattern if civ_rx else None,
                                             "avoid": OPTION_AVOID.pattern, "order": [p.pattern for p in OPTION_PREFS]})
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
    # boutons radio obligatoires (hors civilité) : le meilleur choix du groupe, jamais « particulier », « devis »…
    groups: dict[str, list[dict]] = {}
    for f in fresh:
        if f["type"] == "radio" and f["name"] and f["name"] not in civ_radio:
            groups.setdefault(f["name"], []).append(f)
    radio_pick: dict[str, int] = {}
    radio_none: set[str] = set()
    for name, radios in groups.items():
        if not any(r["required"] for r in radios):
            continue
        choice = pick_option([r["label"] or r["id"] or "" for r in radios])
        if choice is None:
            radio_none.add(name)
        else:
            radio_pick[name] = next(r["i"] for r in radios if (r["label"] or r["id"] or "") == choice)
    lone_name ="last_name" in kinds.values() and "first_name" not in kinds.values()
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
                elif f["required"] and not NEWSLETTER_STRICT.search(text) and not OPTION_AVOID.search(text):
                    _check(loc)
                    res.filled[f"case obligatoire {f['i']}"] = label
            elif kind == "radio" and f["name"] in civ_radio:
                if f["i"] == civ_radio[f["name"]]:
                    _check(loc)
                    radios_done.add(f["name"])
                    res.filled["civilité"] = f"{label}"
            elif kind == "radio":
                if f["name"] not in radios_done and radio_pick.get(f["name"]) == f["i"]:
                    _check(loc)
                    radios_done.add(f["name"])
                    res.filled[f"choix {f['i']}"] = label
                elif f["name"] in radio_none and f["name"] not in radios_done:
                    radios_done.add(f["name"])
                    res.warnings.append(f"choix obligatoire sans réponse possible (devis, rendez-vous…) : {label}")
                    res.missing.append(label)
            elif kind == "select":
                opts = [o for o in f["options"] if o and not re.search(r"^(--|choisi|select|s[eé]lection|veuillez|bitte|elige|seleccion|scegli|kies)", _norm(o))]
                pick = pick_option(opts)
                country = _pick_country(opts, sender)
                if country and (re.search(COUNTRY, _norm(f"{label} {f['name']}")) or len(opts) > 20):
                    pick = country
                elif civ_rx and (re.search(CIVILITY, _norm(f"{label} {f['name']}")) or any(CIV_F.search(o) or CIV_M.search(o) for o in opts)):
                    pick = next((o for o in opts if civ_rx.search(o)), pick)
                if pick:
                    _select(loc, pick)
                    res.filled[f"liste {f['i']}"] = f"{label} = {pick}"
                elif opts and f["required"]:
                    res.warnings.append(f"liste obligatoire sans choix possible (devis, rendez-vous…) : {label}")
                    res.missing.append(label)
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
