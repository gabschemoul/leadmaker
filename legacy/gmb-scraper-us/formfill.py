"""Trouve le formulaire de contact d'un site et remplit ses champs.

Étapes : page d'accueil → lien « Contact » (ou équivalent) → formulaire avec une zone de message →
chaque champ visible est identifié (nom, email, téléphone, société, objet, message…) et rempli.
Les champs invisibles (pièges anti-robots) ne sont jamais touchés et les captchas ne sont pas contournés.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

from playwright.sync_api import Frame, Page, TimeoutError as PWTimeout

CONTACT_LINK = re.compile(r"contact|contactez|nous[- ]?ecrire|ecrivez|joindre|devis|formulaire|get[- ]?in[- ]?touch"
                          r"|reach[- ]?us|request[- ]?a[- ]?quote|free[- ]?quote|get[- ]?a[- ]?quote|estimate|inquir", re.I)
SUCCESS = re.compile(
    r"merci|bien (ete )?(envoye|recu|transmis)|a ete envoye|message (a ete )?envoye|nous vous (repondrons|recontacterons)"
    r"|thank|has been sent|success|we('ll| will) (be in touch|get back|contact you|respond)|been (received|submitted)"
    r"|message (was )?sent|submission (was )?(received|successful)", re.I)
# Envoi refusé par le site (anti-robot, erreur serveur) : on le dit clairement plutôt que « à vérifier ».
FAILURE = re.compile(
    r"recaptcha[^.]{0,60}(echoue|invalide|failed)|utilisation abusive|(envoi|message)[^.]{0,30}(a echoue|n'a pas pu)"
    r"|n'a pas pu etre envoye|une erreur (s'est produite|est survenue)|formulaire non valide|failed to send"
    r"|there was an error|spam detecte|please try again|could not be (sent|submitted)|unable to (send|submit)"
    r"|an error (has )?occurred|captcha (verification )?failed|invalid captcha|flagged as spam", re.I)
CAPTCHA = ('iframe[src*="recaptcha"]:not([src*="size=invisible"]):visible, iframe[src*="hcaptcha"]:visible, '
           '.g-recaptcha:not([data-size="invisible"]):visible, .h-captcha:visible, '
           '.cf-turnstile:visible, iframe[src*="challenges.cloudflare"]:visible, iframe[src*="friendlycaptcha"]:visible')

# Ordre important : le premier motif qui correspond gagne.
COUNTRY = r"\bpays\b|country"
FIELD_RULES = [
    ("email", r"e-?mail|courriel|mail"),
    ("phone", r"t[eé]l|phone|portable|mobile|gsm"),
    ("full_name", r"nom (et|&|/) ?pr[eé]nom|pr[eé]nom (et|&|/) ?nom|nom complet|full ?name"),
    ("first_name", r"pr[eé]nom|first|given|fname"),
    ("company", r"soci[eé]t[eé]|entreprise|company|organi[sz]ation|raison sociale|structure|etablissement|business"),
    ("subject", r"objet|sujet|subject|motif|regarding|topic"),
    ("zip", r"code postal|postal|zip|cp\b"),
    ("country", COUNTRY),
    ("city", r"ville|city|commune|localit"),
    ("address", r"adresse|address|rue"),
    ("website", r"site|url|website|web"),
    ("last_name", r"\bnom\b|last|surname|lname|family"),
    ("full_name", r"name|votre nom"),
    ("message", r"message|commentaire|demande|question|comment|precisions|description|texte|body|content|how can we help"),
]
CONSENT = re.compile(r"rgpd|gdpr|consent|accepte|j'accepte|politique|confidentialit|donnees personnelles|privacy|conditions|cgu|cgv"
                     r"|i agree|agree to the|terms", re.I)
NEWSLETTER = re.compile(r"newsletter|lettre d'information|actualit|offres? (commerciales|promotionnelles)|partenaires"
                        r"|etre (re)?contacte|me contacter|par telephone|sms|subscribe|mailing list|marketing|promotion"
                        r"|special offers|text messages?|receive (updates|news|offers|emails|texts)", re.I)
# Captchas « à recopier » (image, calcul). La simple mention « protégé par reCAPTCHA » (v3 invisible) n'en est pas un.
CAPTCHA_TEXT = re.compile(r"code de securite|entre[rz]? le code|recopie|antispam|anti-spam|combien font|resultat de l'operation"
                          r"|(?<!re)captcha|security code|enter the (code|characters)|what is \d+|solve|math question"
                          r"|prove you", re.I)
CONTACT_PATHS = ["/contact-us", "/contact", "/contact-us/", "/contact/", "/contactus", "/contact-us.html", "/contact.html",
                 "/contact.php"]
SELECT_PREF = re.compile(r"autre|other|information|renseignement|partenariat|commercial|demande|general|contact", re.I)
SUBMIT = re.compile(r"envoy|send|valider|soumettre|submit|contact|transmettre|demander|go\b|ok\b", re.I)


@dataclass
class Sender:
    prenom: str = ""
    nom: str = ""
    societe: str = ""
    email: str = ""
    telephone: str = ""
    site: str = ""
    ville: str = ""
    code_postal: str = ""
    adresse: str = ""
    pays: str = "France"


@dataclass
class FillResult:
    status: str  # "rempli", "captcha", "erreur"
    form_url: str = ""
    filled: dict = field(default_factory=dict)  # type de champ -> libellé du champ
    unknown_required: list = field(default_factory=list)
    missing: list = field(default_factory=list)  # libellés des champs obligatoires non remplis
    detail: str = ""


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _same_site(url: str, base: str) -> bool:
    a, b = urlparse(url).hostname or "", urlparse(base).hostname or ""
    return a.removeprefix("www.") == b.removeprefix("www.")


# Repère dans un cadre (page ou iframe) le meilleur formulaire de contact : celui qui a une zone de message
# et un champ email visibles. Les formulaires de recherche / newsletter / connexion sont ignorés.
FIND_FORM_JS = r"""
() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const containers = [...document.querySelectorAll('form')];
  // Formulaires sans balise <form> (React, Wix…) : on remonte depuis les zones de texte.
  document.querySelectorAll('textarea').forEach(t => { if (!t.closest('form')) {
    let p = t.parentElement; for (let i = 0; i < 6 && p && p.querySelectorAll('input,textarea').length < 3; i++) p = p.parentElement;
    if (p) containers.push(p); } });
  let best = -1, bestScore = 0;
  containers.forEach((f, i) => {
    const fields = [...f.querySelectorAll('input,textarea,select')].filter(vis);
    const ta = fields.filter(e => e.tagName === 'TEXTAREA').length;
    const mail = fields.filter(e => e.type === 'email' || /mail|courriel/i.test((e.name||'') + (e.id||'') + (e.placeholder||''))).length;
    const pwd = fields.filter(e => e.type === 'password').length;
    const search = fields.filter(e => e.type === 'search' || /search|recherche|\bq\b/i.test(e.name||'')).length;
    const score = (ta ? 5 : 0) + (mail ? 3 : 0) + Math.min(fields.length, 8) - (pwd ? 20 : 0) - (search ? 10 : 0);
    if (ta && score > bestScore) { best = i; bestScore = score; }
  });
  if (best < 0) return null;
  containers.forEach(f => f.removeAttribute('data-ff-form'));
  containers[best].setAttribute('data-ff-form', '1');
  return bestScore;
}
"""

# Décrit chaque champ visible du formulaire marqué : type, nom, libellé associé, obligatoire…
DESCRIBE_JS = r"""
() => {
  const form = document.querySelector('[data-ff-form]');
  if (!form) return [];
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const labelOf = el => {
    let t = '';
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t += l.innerText; }
    const pl = el.closest('label'); if (pl) t += ' ' + pl.innerText;
    if (el.getAttribute('aria-label')) t += ' ' + el.getAttribute('aria-label');
    if (!t.trim()) { let p = el.parentElement; for (let i = 0; i < 2 && p; i++, p = p.parentElement) {
      const txt = [...p.childNodes].filter(n => n.nodeType === 3 || ['LABEL','SPAN','P','DIV','LEGEND'].includes(n.tagName))
        .map(n => (n.innerText || n.textContent || '')).join(' ').trim();
      if (txt && txt.length < 120) { t = txt; break; } } }
    return t.replace(/\s+/g, ' ').trim().slice(0, 120);
  };
  // Cases à cocher personnalisées : la vraie case est cachée, on regarde si son libellé est visible.
  const labelVis = el => { const l = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    return !!(l && vis(l)); };
  const captchaImg = !!form.querySelector('img[src*="captcha" i], input[name*="captcha" i]:not([type=hidden]), '
    + 'img[id*="captcha" i], img[class*="captcha" i]');
  return [...form.querySelectorAll('input,textarea,select')].map((el, i) => {
    el.setAttribute('data-ff-i', String(i));
    const box = el.type === 'checkbox' || el.type === 'radio';
    return { i, tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), name: el.name || '', id: el.id || '',
      placeholder: el.placeholder || '', label: labelOf(el), required: el.required || el.getAttribute('aria-required') === 'true'
        || /\*/.test(labelOf(el)), visible: vis(el) || (box && (labelVis(el) || (el.parentElement && vis(el.parentElement)))), autocomplete: el.autocomplete || '',
      captchaImg,
      options: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()) : [] };
  });
}
"""

# Après remplissage : validation du navigateur. Listes / boutons radio obligatoires encore vides → première option
# valable ; renvoie les champs toujours refusés et la longueur max du message si le site l'a coupé.
VALIDATE_JS = r"""
() => {
  const form = document.querySelector('[data-ff-form]');
  if (!form) return {invalid: [], truncated: 0};
  const els = [...form.querySelectorAll('[data-ff-i]')].filter(el => el.willValidate);
  const fire = el => ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, {bubbles: true})));
  for (const el of els) {
    if (el.checkValidity()) continue;
    if (el.tagName === 'SELECT') {
      const o = [...el.options].find(o => o.value && !o.disabled);
      if (o) { el.value = o.value; fire(el); }
    } else if (el.type === 'radio' && el.name) {
      const first = form.querySelector(`input[type=radio][name="${CSS.escape(el.name)}"]`);
      if (first) { first.checked = true; fire(first); }
    }
  }
  const ta = [...form.querySelectorAll('textarea')].find(t => t.maxLength > 0 && t.value.length >= t.maxLength);
  return {invalid: els.filter(el => !el.checkValidity()).map(el => +el.dataset.ffI), truncated: ta ? ta.maxLength : 0};
}
"""


def classify(f: dict) -> str | None:
    if f["tag"] == "textarea":
        return "message"
    if f["type"] in ("hidden", "submit", "button", "image", "reset", "file", "password", "search"):
        return None
    if f["type"] == "email":
        return "email"
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
              "tel": "phone", "organization": "company", "postal-code": "zip", "address-level2": "city"}
    if ac in ac_map:
        return ac_map[ac]
    text = _norm(" ".join([f["label"], f["placeholder"], f["name"], f["id"]]))
    for kind, pattern in FIELD_RULES:
        if re.search(pattern, text):
            return kind
    return "unknown"


def _values(sender: Sender, subject: str, message: str) -> dict[str, str]:
    return {
        "email": sender.email, "phone": sender.telephone, "first_name": sender.prenom, "last_name": sender.nom,
        "full_name": f"{sender.prenom} {sender.nom}".strip(), "company": sender.societe, "subject": subject,
        "message": message, "website": sender.site, "city": sender.ville, "zip": sender.code_postal,
        "address": sender.adresse, "country": sender.pays,
    }


def _find_form(page: Page) -> Frame | None:
    for frame in [page.main_frame, *[f for f in page.frames if f != page.main_frame]]:
        try:
            if frame.evaluate(FIND_FORM_JS):
                return frame
        except Exception:
            continue
    return None


def _contact_links(page: Page, base: str) -> list[str]:
    links = page.evaluate("""() => [...document.querySelectorAll('a[href]')].map(a => [a.href, (a.innerText || a.title || '').trim()])""")
    scored = []
    for href, text in links:
        if not href.startswith("http") or not _same_site(href, base):
            continue
        t = _norm(f"{text} {urlparse(href).path}")
        if CONTACT_LINK.search(t) and not re.search(r"mentions|cgv|cgu|legal|politique|recrut|carriere|job|privacy|terms"
                                                    r"|career|employment|hiring", t):
            score = 2 if re.search(r"contact", t) else 1
            scored.append((score, href.split("#")[0]))
    seen, out = set(), []
    for _, h in sorted(scored, key=lambda x: -x[0]):
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out[:3]


def _load(page: Page, url: str, timeout: int):
    page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    page.wait_for_timeout(2000)
    _dismiss_cookies(page)
    # Fait défiler la page : certains formulaires (Wix, chargement différé) n'apparaissent qu'en bas.
    for _ in range(4):
        page.mouse.wheel(0, 2500)
        page.wait_for_timeout(400)
    page.wait_for_timeout(800)


def open_contact_form(page: Page, site: str, timeout: int = 25000) -> Frame | None:
    """Ouvre le site et renvoie le cadre contenant le formulaire de contact (ou None)."""
    _load(page, site, timeout)
    frame = _find_form(page)
    if frame:
        return frame
    home = page.url
    candidates = _contact_links(page, home)
    if not candidates:  # pas de lien « Contact » : on tente les adresses classiques
        root = f"{urlparse(home).scheme}://{urlparse(home).netloc}"
        candidates = [root + p for p in CONTACT_PATHS]
    for link in candidates:
        try:
            resp = page.goto(link, wait_until="domcontentloaded", timeout=timeout)
            if resp is not None and resp.status >= 400:
                continue
            page.wait_for_timeout(1500)
            _dismiss_cookies(page)
            for _ in range(4):
                page.mouse.wheel(0, 2500)
                page.wait_for_timeout(400)
            frame = _find_form(page)
            if frame:
                return frame
        except PWTimeout:
            continue
    return None


# Boutons « tout accepter » des bandeaux cookies courants (OneTrust, Didomi, Axeptio, Cookiebot, Complianz, CookieYes,
# tarteaucitron, iubenda, Quantcast, Borlabs…)
COOKIE_SELECTORS = [
    "#onetrust-accept-btn-handler", "#didomi-notice-agree-button", "#axeptio_btn_acceptAll",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", "#CybotCookiebotDialogBodyButtonAccept",
    ".cmplz-accept", ".cky-btn-accept", "#tarteaucitronPersonalize2", "#tarteaucitronAllAllowed", ".tarteaucitronAllow",
    ".iubenda-cs-accept-btn", ".qc-cmp2-summary-buttons button[mode=primary]", "a._brlbs-btn-accept-all",
    "#cookie_action_close_header", ".cc-allow", ".cc-accept", "#hs-eu-confirmation-button", ".sp_choice_type_11",
    "[data-cookiefirst-action=accept]", "#acceptAllCookies", "#accept-all-cookies", "#cookie-accept",
]
COOKIE_ACCEPT = re.compile(r"^\W*(tout accepter|accepter|j'accepte|oui,? j'accepte|autoriser|d'accord|ok|compris|"
                           r"accept|allow all|agree|i agree|got it)\b[^\n]{0,30}$", re.I)


def _dismiss_cookies(page: Page):
    """Accepte le bandeau cookies s'il y en a un (aussi dans les iframes de consentement)."""
    for frame in page.frames:
        try:
            for sel in COOKIE_SELECTORS:
                loc = frame.locator(f"{sel}:visible")
                if loc.count():
                    loc.first.click(timeout=2000)
                    page.wait_for_timeout(700)
                    return
            for role in ("button", "link"):
                loc = frame.get_by_role(role, name=COOKIE_ACCEPT)
                for j in range(min(loc.count(), 3)):
                    if loc.nth(j).is_visible():
                        loc.nth(j).click(timeout=2000)
                        page.wait_for_timeout(700)
                        return
        except Exception:
            continue


def _check(loc):
    try:
        loc.check(timeout=2000, force=True)
    except Exception:
        loc.evaluate("""el => { el.click(); if (!el.checked) { el.checked = true;
            el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); } }""")


def fill_form(frame: Frame, sender: Sender, subject: str, message: str, extra: dict | None = None) -> FillResult:
    """extra : valeurs saisies à la main pour des champs précis ({libellé du champ: valeur})."""
    fields = frame.evaluate(DESCRIBE_JS)
    values = _values(sender, subject, message)
    res = FillResult(status="rempli", form_url=frame.url)
    if any(f.get("captchaImg") for f in fields[:1]) or any(CAPTCHA_TEXT.search(_norm(f["label"] + " " + f["name"]))
                                                           for f in fields if f["visible"]):
        res.status, res.detail = "captcha", "captcha dans le formulaire"
    has_message = False
    radios_done: set[str] = set()
    kinds = {f["i"]: classify(f) for f in fields if f["visible"]}
    # Un seul champ « nom » sans champ prénom : on y met le nom complet.
    lone_name = "last_name" in kinds.values() and "first_name" not in kinds.values()
    for f in fields:
        if not f["visible"]:
            continue  # champs cachés = pièges anti-robots : on n'y touche pas
        kind = kinds[f["i"]]
        if kind == "last_name" and lone_name:
            kind = "full_name"
        if kind is None:
            continue
        loc = frame.locator(f'[data-ff-i="{f["i"]}"]')
        label = f["label"] or f["placeholder"] or f["name"] or f["id"]
        try:
            if extra and extra.get(label, "").strip():
                if kind == "select":
                    loc.select_option(label=extra[label], timeout=3000)
                else:
                    loc.fill(extra[label], timeout=5000)
                res.filled[f"saisi {f['i']}"] = label
            elif kind == "checkbox":
                text = _norm(f"{f['label']} {f['name']}")
                if CONSENT.search(text) and not NEWSLETTER.search(text):
                    _check(loc)
                    res.filled["consentement"] = label
                elif f["required"] and not NEWSLETTER.search(text):
                    _check(loc)
                    res.filled[f"case obligatoire {f['i']}"] = label
            elif kind == "radio":
                if f["name"] not in radios_done and f["required"]:
                    _check(loc)
                    radios_done.add(f["name"])
            elif kind == "select":
                opts = [o for o in f["options"] if o and not re.search(r"^(--|choisi|select|s[eé]lection|veuillez)", _norm(o))]
                pick = next((o for o in opts if SELECT_PREF.search(_norm(o))), opts[0] if opts else None)
                if re.search(COUNTRY, _norm(f"{label} {f['name']}")):  # liste de pays : on prend le tien
                    pick = next((o for o in opts if _norm(o).strip() == _norm(sender.pays)), pick)
                if pick:
                    loc.select_option(label=pick, timeout=3000)
                    res.filled[f"liste {f['i']}"] = f"{label} = {pick}"
            elif kind == "unknown":
                if CAPTCHA_TEXT.search(_norm(label)):
                    continue
                if f["required"]:
                    res.unknown_required.append(label)
                    res.missing.append(label)
            else:
                value = values.get(kind, "")
                if not value:
                    if f["required"]:
                        res.unknown_required.append(f"{label} (valeur « {kind} » vide dans ton profil)")
                        res.missing.append(label)
                    continue
                if kind == "message":
                    if has_message:
                        continue
                    has_message = True
                if f["type"] == "number":  # champ numérique (téléphone, code postal) : chiffres uniquement
                    value = re.sub(r"\D", "", value)
                loc.fill(value, timeout=5000)
                res.filled[kind] = label
        except Exception as e:  # champ non modifiable, masqué par un widget…
            if f["required"]:
                res.unknown_required.append(f"{label} ({type(e).__name__})")
                res.missing.append(label)
    if res.status == "captcha":
        return res
    try:
        check = frame.evaluate(VALIDATE_JS)
    except Exception:
        check = {"invalid": [], "truncated": 0}
    by_i = {f["i"]: f for f in fields}
    for i in check["invalid"]:
        f = by_i.get(i)
        label = f and (f["label"] or f["placeholder"] or f["name"] or f["id"])
        if f and f["visible"] and label not in res.missing:
            res.missing.append(label)
            res.unknown_required.append(f"{label} (refusé par le formulaire)")
    if check["truncated"]:
        res.detail = f"message coupé à {check['truncated']} caractères par le site : raccourcis-le"
    if not has_message:
        res.status, res.detail = "erreur", "zone de message non remplie"
    elif "email" not in res.filled and not res.detail:
        res.detail = "pas de champ email dans ce formulaire : ton email doit figurer dans le message"
    return res


def has_captcha(frame: Frame) -> bool:
    """Captcha visible (reCAPTCHA case à cocher, hCaptcha, Turnstile…). Le reCAPTCHA v3 invisible n'est pas compté."""
    try:
        form = frame.locator("[data-ff-form]")
        return frame.locator(CAPTCHA).count() > 0 or (form.count() > 0 and form.locator(CAPTCHA).count() > 0)
    except Exception:
        return False


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
        except Exception:  # bouton recouvert (bandeau cookies, widget de chat…) : clic direct
            btn.first.evaluate("b => b.click()")
    elif not frame.evaluate("""() => { const f = document.querySelector('[data-ff-form]');
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
        return None, f"refusé par le site (« {m.group(0)} ») : à envoyer à la main"
    if SUCCESS.search(text):
        return True, "confirmation affichée"
    if frame.url != url_before:
        return True, "page changée après envoi"
    try:
        if not form.count() or not form.first.is_visible():
            return True, "formulaire disparu après envoi"
    except Exception:
        pass
    return False, "pas de confirmation visible (champ refusé ou captcha invisible ?)"
