"""Traite UN site dans un processus à part (lancé par le runner, coupé net au-delà du délai).

    echo '<json>' | python -m leadmaker_workers.outreach.site_job

Entrée (stdin) : {"mode": "prepare" | "send" | "emails", "site": ..., "sender": {...}, "subject": ..., "body": ..., "short_body": ...,
                  "extra": {...}, "locale": "fr-FR", "headless": true}
Sortie (stdout, dernière ligne) : {"status": ..., "form_url": ..., "filled": {...}, "missing": [...],
                  "detail": ..., "protection_type": ..., "short": bool, "found_email": ..., "screenshot_b64": ...}
"""
from __future__ import annotations

import base64
import json
import os
import signal
import sys
import time
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

from ..discovery.scraper import USER_AGENT, proxy_from_env
from . import ai_check, netguard
from .formfill import (CONTACT_PATHS, QUOTE_DETAIL, Sender, SiteDown, SiteGone, _check_alive, _contact_links, _dismiss_cookies,
                       _dismiss_overlays,
                       _same_site, best_email, detect_protection, fill_form, harvest_emails, legal_links, open_contact_form,
                       own_email, submit)

BLOCKED_RESOURCES = ("media", "font")  # les images restent : elles comptent dans la capture
# Garde-fou : une page qui ne répond plus (script bloqué, iframe muette) interrompt le travail au bout de ce délai,
# et le résultat partiel (e-mails relevés, pages vues) est quand même renvoyé.
SOFT_DEADLINE = int(os.environ.get("SITE_SOFT_DEADLINE", "70"))


class SiteHang(BaseException):
    """BaseException : ne doit pas être avalée par les « except Exception » du moteur."""


def _arm_watchdog() -> None:
    def _hang(*_: object) -> None:
        raise SiteHang(f"page bloquée plus de {SOFT_DEADLINE} s")

    signal.signal(signal.SIGALRM, _hang)
    signal.alarm(SOFT_DEADLINE)


# Boucle IA (12/11/2026) : contrôle pendant que le formulaire est ouvert ; corrections limitées aux données de l'agence,
# à l'objet et aux choix des listes ; 2 tours de correction au plus, dans un temps borné (le travail entier est coupé à
# PREPARE_TIMEOUT par le robot parent).
AI_ROUNDS = 2
AI_START_MAX = float(os.environ.get("AI_LOOP_START_MAX", "55"))   # au-delà (page lente), contrôle simple par le robot parent
AI_LOOP_BUDGET = int(os.environ.get("AI_LOOP_BUDGET", "40"))

FIELD_VALUES_JS = r"""() => {
  const out = {};
  document.querySelectorAll('[data-ff-i]').forEach(el => {
    const i = el.getAttribute('data-ff-i'); const t = (el.type || '').toLowerCase();
    out[i] = (t === 'checkbox' || t === 'radio') ? (el.checked ? 'coché' : 'non coché')
      : el.tagName === 'SELECT' ? ((el.options[el.selectedIndex] || {}).text || '').trim() : (el.value || '');
  });
  return out;
}"""


def _ai_fields(frame) -> list[dict]:
    from .formfill import DESCRIBE_JS
    fields = frame.evaluate(DESCRIBE_JS)
    values = frame.evaluate(FIELD_VALUES_JS)
    out = []
    for f in fields:
        if not f.get("visible") or f.get("type") in ("hidden", "submit", "button", "file", "password", "image", "reset"):
            continue
        key = f.get("label") or f.get("placeholder") or f.get("name") or f.get("id")
        if not key:
            continue
        out.append({**f, "key": key, "value": values.get(str(f["i"]), "")})
    return out


def _agency(sender: Sender, subject: str) -> dict[str, str]:
    return {"prénom": sender.first_name, "nom": sender.last_name, "nom complet": f"{sender.first_name} {sender.last_name}".strip(),
            "société": sender.company, "e-mail": sender.email, "téléphone": sender.phone, "site": sender.website,
            "adresse": sender.address, "code postal": sender.zip, "ville": sender.city,
            "pays": sender.country_names[0] if sender.country_names else "", "objet": subject}


def _valid_fixes(fixes, fields: list[dict], agency: dict[str, str]) -> dict[str, str]:
    """Ne garde que les corrections sûres : champ connu et visible, valeur prise dans les données de l'agence, « oui »
    pour une case, ou un des choix de la liste. Renvoie {libellé du champ: valeur} (format « extra » du robot)."""
    by_i = {f["i"]: f for f in fields}
    allowed = {v.strip() for v in agency.values() if v and v.strip()}
    out: dict[str, str] = {}
    for fx in fixes or []:
        f = by_i.get(fx.field)
        val = (fx.value or "").strip()
        if not f or not val:
            continue
        if f["type"] in ("checkbox", "radio"):
            if val.lower() in ("oui", "yes"):
                out[f["key"]] = "oui"
        elif f["tag"] == "select":
            match = next((o for o in f.get("options", []) if o.strip().lower() == val.lower()), None)
            if match:
                out[f["key"]] = match
        elif val in allowed:
            out[f["key"]] = val
    return out


def _ai_loop(page, frame, sender: Sender, job: dict, out: dict) -> None:
    """Contrôle IA avec corrections. Écrit dans out : ai_checked, ai_alert (None = bon), ai_fixes, et met à jour
    filled / missing / capture / contexte / statut après correction."""
    out["ai_checked"] = True
    agency = _agency(sender, job.get("subject", ""))
    extra = dict(job.get("extra") or {})
    done: dict[str, str] = {}
    signal.alarm(AI_LOOP_BUDGET)
    try:
        for rnd in range(AI_ROUNDS + 1):
            fields = _ai_fields(frame)
            v = ai_check.review_fix(out.get("form_url") or "", out.get("filled") or {}, out.get("context"),
                                    out.get("screenshot_b64") or "", fields, agency)
            if v is None:
                out["ai_alert"] = ai_check.UNAVAILABLE
                break
            if ai_check.passes(v):
                out["ai_alert"] = None
                break
            fixes = {k: val for k, val in _valid_fixes(v.fixes, fields, agency).items() if extra.get(k) != val}
            if not fixes or rnd == AI_ROUNDS:
                out["ai_alert"] = ai_check.BLOCKED + (v.reason.strip() or v.form_type)[:300]
                break
            extra.update(fixes)
            done.update(fixes)
            r = fill_form(frame, sender, job.get("subject", ""), job["body"], extra,
                          short_message=job.get("short_body", ""), locale=job.get("locale", ""))
            out.update(filled=r.filled, missing=r.missing, short=r.short, screenshot_b64=_screenshot(page, frame))
            out["context"] = _context(page, frame)
            if r.missing:
                out["status"] = "incomplete"
    except SiteHang:
        out["ai_alert"] = "à vérifier — contrôle IA interrompu (page trop lente)"
    except Exception as exc:
        out["ai_alert"] = f"à vérifier — contrôle IA interrompu ({type(exc).__name__})"
    finally:
        signal.alarm(0)
    if done:
        out["ai_fixes"] = {**(out.get("ai_fixes") or {}), **done}
        note = "corrigé par l'IA : " + ", ".join(f"« {k[:40]} » ← {v[:40]}" for k, v in done.items())
        out["detail"] = "; ".join(filter(None, [out.get("detail"), note]))


# IA de secours (13/11/2026) : champs visibles de toute la page (tous les cadres), numérotés pour l'IA
RESCUE_FIELDS_JS = r"""(start) => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const lab = el => { const l = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    return [(l || {}).innerText, el.closest('label') && el.closest('label').innerText, el.getAttribute('aria-label'),
            el.placeholder, el.name].filter(Boolean).join(' / ').replace(/\s+/g, ' ').slice(0, 120); };
  let k = start; const out = [];
  document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]),textarea,select').forEach(el => {
    if (!vis(el) || k - start >= 40) return;
    el.setAttribute('data-ff-ai', String(k));
    out.push({k, tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), label: lab(el),
              required: el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(lab(el))});
    k++;
  });
  return out;
}"""

# le formulaire qui contient la case choisie par l'IA devient le formulaire du robot
RESCUE_PICK_JS = r"""(k) => {
  const el = document.querySelector(`[data-ff-ai="${k}"]`); if (!el) return false;
  let c = el.closest('form');
  if (!c) { c = el.parentElement; for (let i = 0; i < 8 && c && c.querySelectorAll('input,textarea,select').length < 3; i++) c = c.parentElement; }
  if (!c) return false;
  document.querySelectorAll('[data-ff-form]').forEach(f => f.removeAttribute('data-ff-form'));
  c.setAttribute('data-ff-form', '1');
  return true;
}"""


def _ai_rescue(page, sender: Sender, job: dict):
    """Le robot n'a pas de zone de message : l'IA désigne le formulaire de contact et la case du message.
    Renvoie (cadre, résultat du remplissage) si c'est réparé, sinon None."""
    from .formfill import DESCRIBE_JS, SKIP_FRAME
    frames = [page.main_frame] + [f for f in page.frames if f != page.main_frame and f.url and not SKIP_FRAME.search(f.url)]
    fields, owner = [], {}
    for idx, fr in enumerate(frames[:8]):
        try:
            got = fr.evaluate(RESCUE_FIELDS_JS, len(fields))
        except Exception:
            continue
        for f in got:
            f["frame"] = idx
            owner[f["k"]] = fr
        fields += got
    if not fields:
        return None
    try:
        shot = base64.b64encode(page.screenshot(full_page=True, timeout=8000)).decode("ascii")
    except Exception:
        shot = ""
    v = ai_check.rescue(page.url, shot, fields)
    if not v or not v.contact or v.message_field is None or v.message_field not in owner:
        return None
    fr = owner[v.message_field]
    if not fr.evaluate(RESCUE_PICK_JS, v.message_field):
        return None
    # libellé de la case du message tel que le robot le voit, pour la remplir comme une saisie à la main
    fr.evaluate(DESCRIBE_JS)
    i = fr.evaluate(f"() => (document.querySelector('[data-ff-ai=\"{v.message_field}\"]') || {{}}).getAttribute && "
                    f"document.querySelector('[data-ff-ai=\"{v.message_field}\"]').getAttribute('data-ff-i')")
    desc = {str(d["i"]): d for d in fr.evaluate(DESCRIBE_JS)}
    d = desc.get(str(i))
    if not d:
        return None
    key = d.get("label") or d.get("placeholder") or d.get("name") or d.get("id")
    if not key:
        return None
    extra = {**(job.get("extra") or {}), key: job["body"]}
    job["extra"] = extra  # la boucle IA et l'envoi rejouent la même case
    r = fill_form(fr, sender, job.get("subject", ""), job["body"], extra, short_message=job.get("short_body", ""),
                  locale=job.get("locale", ""))
    if "message" not in r.filled:
        r.filled["message"] = key  # la case désignée par l'IA a reçu le message (saisie « à la main »)
    r.warnings = [w for w in r.warnings if not w.startswith("pas de zone de message")]
    r.warnings.append(f"formulaire et zone de message désignés par l'IA de secours ({v.reason[:100]})")
    return fr, r


def _screenshot(page, frame) -> str:
    # une fenêtre de promotion apparue entre-temps cacherait le formulaire ; et certaines cases dessinent leur coche avec
    # une petite animation : sans attendre, la capture montre une case vide alors qu'elle est cochée (12/11/2026)
    _dismiss_overlays(page, frame)
    try:
        page.wait_for_timeout(500)
    except Exception:
        pass
    try:
        data = frame.locator("[data-ff-form]").first.screenshot(timeout=5000)
    except Exception:
        try:
            data = page.screenshot(full_page=False)
        except Exception:
            return ""
    return base64.b64encode(data).decode("ascii")


# contexte du formulaire choisi pour le contrôle IA (ai_check.py) : titre de la page, 3 derniers titres juste au-dessus
# (balises de titre ou texte écrit en gros), texte du formulaire (libellés, choix des listes)
CONTEXT_JS = r"""() => {
  const f = document.querySelector('[data-ff-form]'); const N = s => (s || '').replace(/\s+/g, ' ').trim();
  if (!f) return {title: document.title, before: [], form: ''};
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading],p,strong,b,span,div')].filter(e => {
    if (f.contains(e) || !(e.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
    const t = N(e.textContent); if (t.length < 3 || t.length > 100) return false;
    if (/^H[1-6]$/.test(e.tagName) || e.getAttribute('role') === 'heading') return true;
    if (e.closest('a,button,nav,header,footer,li,label,form,h1,h2,h3,h4,h5,h6') || e.querySelector('input,textarea,select,a,button')) return false;
    return parseFloat(getComputedStyle(e).fontSize) >= 24;
  });
  // seulement les titres proches du formulaire (moins de 400 lettres de texte entre eux) : un titre ailleurs dans la page
  // n'est pas le sien (12/11/2026 palacioshomeco.com : « Need Help Choosing Furniture? » loin au-dessus, envoi bloqué)
  const gap = h => { try { const r = document.createRange(); r.setStartAfter(h); r.setEndBefore(f); return N(r.toString()).length; }
    catch (e) { return 1e9; } };
  const near = heads.slice(-3).filter(h => gap(h) < 400);
  return {title: document.title, before: [...new Set(near.map(e => N(e.innerText || e.textContent).slice(0, 100)))],
          form: N(f.innerText).slice(0, 1500)};
}"""


def _context(page, frame) -> dict:
    try:
        c = frame.evaluate(CONTEXT_JS)
        if frame is not page:
            c["title"] = page.title()
        return c
    except Exception:
        return {}


def _quote_reason(quotes: list) -> str:
    """« page /devis : champ « type de travaux » » : le premier formulaire de devis écarté, pour l'explication."""
    url, why = quotes[0]
    return why if why.startswith("lien") else f"{urlparse(url).path or '/'} : {why}"


# Formulaire caché (fenêtre qui s'ouvre au clic) ou sans e-mail ni téléphone : rien d'utile n'a pu être écrit, il
# n'est jamais « prêt » ni envoyé (6/11/2026 : 37 formulaires « prêts » vides).
NO_MESSAGE = "pas de zone de message sur ce formulaire : rien n'est envoyé"
UNUSABLE = "formulaire inutilisable : ni e-mail ni téléphone n'ont pu être remplis (formulaire caché ou incomplet)"


def _can_reply(filled: dict) -> bool:
    return "email" in filled or "phone" in filled or any(k.startswith("saisi") for k in filled)


def _same_page(a: str, b: str) -> bool:
    pa, pb = urlparse(a or ""), urlparse(b or "")
    return ((pa.hostname or "").removeprefix("www.") == (pb.hostname or "").removeprefix("www.")
            and (pa.path or "/").rstrip("/") == (pb.path or "/").rstrip("/"))


def prepare(job: dict) -> dict:
    started = time.monotonic()
    sender = Sender(**job["sender"])
    emails: set[str] = set()
    visited: list[str] = []
    quotes: list = []
    out: dict = {"status": "unreachable", "filled": {}, "missing": [], "detail": ""}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=job.get("headless", True), proxy=proxy_from_env("OUTREACH_PROXY_URL"))
        ctx = browser.new_context(user_agent=USER_AGENT, locale=job.get("locale", "en-US"),
                                  viewport={"width": 1280, "height": 900},
                                  ignore_https_errors=True)  # certificats expirés : on visite quand même (choix de Gabriel)
        ctx.set_default_timeout(15000)
        netguard.install(ctx, BLOCKED_RESOURCES)
        page = ctx.new_page()
        _arm_watchdog()
        try:
            frame = open_contact_form(page, job["site"], emails=emails, visited=visited, quotes=quotes,
                                      contact_first=True)
            if not frame and quotes:  # seulement des formulaires de devis / rendez-vous : jamais remplis
                out.update(status="no_form", detail=f"{QUOTE_DETAIL} ({_quote_reason(quotes)} ; pages vues : "
                           + ", ".join(dict.fromkeys(visited)) + ")")
            elif not frame:
                out.update(status="no_form", detail="aucun formulaire de contact trouvé (pages vues : "
                           + ", ".join(dict.fromkeys(visited)) + ")")
            else:
                r = fill_form(frame, sender, job.get("subject", ""), job["body"], job.get("extra") or {},
                              short_message=job.get("short_body", ""), locale=job.get("locale", ""))
                if "message" not in r.filled and r.status != "error" and ai_check.enabled() \
                        and time.monotonic() - started < AI_START_MAX:
                    try:
                        fixed = _ai_rescue(page, sender, job)
                    except Exception:
                        fixed = None
                    if fixed:
                        frame, r = fixed
                        out["ai_fixes"] = {r.filled["message"]: job["body"]}  # gardé dans lm_attempts.extra pour l'envoi
                protection = r.protection or detect_protection(frame)
                if "message" not in r.filled and r.status != "error":
                    # sans zone de message, rien ne part jamais, même à la main (12/11/2026, règle de Gabriel)
                    status = "no_form"
                    protection = None
                    r.warnings = [NO_MESSAGE] + [w for w in r.warnings if not w.startswith("pas de zone de message")]
                elif protection:
                    status = "intervention_required"
                elif r.status == "error":
                    status = "failed"
                elif not _can_reply(r.filled):
                    status = "no_form"
                    r.warnings.insert(0, UNUSABLE)
                elif r.missing:
                    status = "incomplete"
                else:
                    status = "ready"
                detail = "; ".join(filter(None, [r.detail] + r.warnings))
                if protection and not r.detail:
                    detail = "; ".join(filter(None, [f"protection anti-robot : {protection}", detail]))
                out.update(status=status, form_url=r.form_url, filled=r.filled, missing=r.missing, detail=detail,
                           protection_type=protection, short=r.short, screenshot_b64=_screenshot(page, frame))
                if status == "ready":
                    out["context"] = _context(page, frame)
                    if ai_check.enabled() and time.monotonic() - started < AI_START_MAX:
                        signal.alarm(0)  # le chien de garde de la page laisse la place à celui de la boucle IA
                        _ai_loop(page, frame, sender, job, out)
        except SiteDown as e:
            out.update(status="unreachable", detail=f"site hors ligne ou en construction (« {e} »)",
                       site_dead=isinstance(e, SiteGone))
        except SiteHang as e:
            out.update(status="unreachable", detail=f"site bloqué : {e} (pages vues : " + ", ".join(dict.fromkeys(visited)) + ")")
            _finish_now(out, job["site"], emails, visited)
        except Exception as e:
            out.update(status="unreachable", detail=f"site inaccessible : {type(e).__name__}: {str(e)[:150]}",
                       site_dead="ERR_NAME_NOT_RESOLVED" in str(e))
        finally:
            signal.alarm(0)
            out["found_email"] = best_email(job["site"], emails, job.get("name", ""))
            out["visited"] = list(dict.fromkeys(visited))
            try:
                ctx.close()
                browser.close()
            except Exception:
                pass
    return out


def _finish_now(out: dict, site: str, emails: set[str], visited: list[str]) -> None:
    """Après un blocage, le navigateur peut ne plus répondre : on écrit le résultat et on sort sans attendre."""
    signal.alarm(0)
    out["found_email"] = best_email(site, emails)
    out["visited"] = list(dict.fromkeys(visited))
    sys.stdout.write("\n" + json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    os._exit(0)


def send(job: dict) -> dict:
    """Rouvre le formulaire validé, le remplit à nouveau (avec les valeurs saisies à la main) et l'envoie."""
    sender = Sender(**job["sender"])
    out: dict = {"status": "failed", "submitted": False, "filled": {}, "missing": [], "detail": ""}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=job.get("headless", True), proxy=proxy_from_env("OUTREACH_PROXY_URL"))
        ctx = browser.new_context(user_agent=USER_AGENT, locale=job.get("locale", "en-US"),
                                  viewport={"width": 1280, "height": 900},
                                  ignore_https_errors=True)  # certificats expirés : on visite quand même (choix de Gabriel)
        ctx.set_default_timeout(15000)
        netguard.install(ctx)
        page = ctx.new_page()
        quotes: list = []
        try:
            frame = open_contact_form(page, job.get("form_url") or job["site"], quotes=quotes)
            if not frame and job.get("form_url") and not quotes:
                frame = open_contact_form(page, job["site"], quotes=quotes)
            # Formulaire de devis : jamais envoyé. Ni celui validé, ni un autre trouvé à sa place sur une autre page
            # (il n'aurait pas été relu).
            if quotes and (not frame or (job.get("form_url") and not _same_page(frame.page.url, job["form_url"]))):
                out.update(status="no_form", detail=f"{QUOTE_DETAIL} : rien n'a été envoyé ({_quote_reason(quotes)})")
            elif not frame:
                out.update(status="failed", detail="formulaire introuvable au moment de l'envoi")
            else:
                r = fill_form(frame, sender, job.get("subject", ""), job["body"], job.get("extra") or {},
                              short_message=job.get("short_body", ""), locale=job.get("locale", ""))
                protection = r.protection or detect_protection(frame)
                if "message" not in r.filled and r.status != "error":
                    # même règle qu'à la préparation : sans zone de message, rien ne part jamais
                    out.update(status="no_form", detail=f"{NO_MESSAGE} (au moment de l'envoi)")
                elif protection:
                    out.update(status="intervention_required", protection_type=protection,
                               detail=f"protection anti-robot au moment de l'envoi : {protection}",
                               screenshot_b64=_screenshot(page, frame))
                elif r.status == "error":
                    out.update(status="failed", detail=r.detail or "formulaire non rempli")
                elif not _can_reply(r.filled):
                    out.update(status="no_form", detail=f"{UNUSABLE} : rien n'a été envoyé")
                elif r.missing:  # le site refuserait l'envoi : retour « à compléter »
                    out.update(status="incomplete", missing=r.missing,
                               detail="; ".join(["champs à renseigner avant envoi"] + r.warnings))
                else:
                    out["submitted"] = True
                    ok, detail = submit(frame)
                    if isinstance(ok, str):  # vérification anti-robot apparue après le clic : rien n'est parti
                        out.update(status="intervention_required", submitted=False, protection_type=ok, detail=detail,
                                   screenshot_b64=_screenshot(page, frame))
                    else:
                        status = {True: "sent", False: "to_verify", None: "failed"}[ok]
                        out.update(status=status, detail=detail, short=r.short, filled=r.filled,
                                   screenshot_b64=_screenshot(page, frame))
        except SiteDown as e:
            if "protégé contre les robots" in str(e):
                # filtre anti-robot de l'hébergeur (12/11/2026 : « One moment, please… » vu du serveur d'envoi seulement) :
                # rien n'est parti, à réessayer plus tard (le blocage d'une adresse est souvent temporaire)
                out.update(status="intervention_required", protection_type="hebergeur",
                           detail=f"l'hébergeur du site bloque le robot d'envoi (« {e} ») : rien n'est parti, à réessayer plus tard")
            else:
                out.update(status="failed", detail=f"site hors ligne (« {e} »)")
        except Exception as e:
            if out["submitted"]:  # erreur après le clic : on ne sait pas si c'est parti
                out.update(status="to_verify", detail=f"erreur après l'envoi : {type(e).__name__}")
            else:
                out.update(status="failed", detail=f"site inaccessible : {type(e).__name__}: {str(e)[:150]}")
        finally:
            try:
                ctx.close()
                browser.close()
            except Exception:
                pass
    return out


def find_emails(job: dict) -> dict:
    """Relève l'adresse e-mail du site sans remplir de formulaire : accueil, puis pages contact et mentions
    légales jusqu'à trouver une adresse au domaine du site."""
    site = job["site"]
    emails: dict[str, set[str]] = {}
    visited: list[str] = []
    out: dict = {"found_email": None, "emails": [], "visited": [], "detail": ""}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=job.get("headless", True), proxy=proxy_from_env("OUTREACH_PROXY_URL"))
        ctx = browser.new_context(user_agent=USER_AGENT, locale=job.get("locale", "en-US"),
                                  viewport={"width": 1280, "height": 900}, ignore_https_errors=True)
        ctx.set_default_timeout(15000)
        netguard.install(ctx, ("image", "media", "font"))
        page = ctx.new_page()
        _arm_watchdog()
        try:
            page.goto(site, wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(1500)
            _check_alive(page)
            visited.append("accueil")
            _dismiss_cookies(page)
            harvest_emails(page, site, emails, "accueil")
            if not own_email(site, emails):
                home = page.url
                root = f"{urlparse(home).scheme}://{urlparse(home).netloc}"
                contact = [c for c in _contact_links(page, home) if _same_site(c, home)][:3]
                legal = legal_links(page, home)
                candidates = contact + legal
                for path in CONTACT_PATHS[:2] + ["/mentions-legales", "/mentions-legales/"]:
                    if root + path not in candidates:
                        candidates.append(root + path)
                for link in candidates[:8]:
                    try:
                        resp = page.goto(link, wait_until="domcontentloaded", timeout=15000)
                    except PWTimeout:
                        continue
                    if resp is not None and resp.status >= 400:
                        continue
                    visited.append(urlparse(link).path or "/")
                    page.wait_for_timeout(800)
                    harvest_emails(page, site, emails, "legal" if link in legal or "mention" in link else "contact")
                    if own_email(site, emails):
                        break
        except SiteDown as e:
            out["detail"] = f"site hors ligne ou en construction (« {e} »)"
        except SiteHang as e:
            out["detail"] = f"site bloqué : {e}"
            out["emails"] = sorted(emails)
            _finish_now(out, site, emails, visited)
        except Exception as e:
            out["detail"] = f"site inaccessible : {type(e).__name__}: {str(e)[:150]}"
        finally:
            signal.alarm(0)
            out.update(found_email=best_email(site, emails, job.get("name", "")), emails=sorted(emails),
                       visited=list(dict.fromkeys(visited)))
            try:
                ctx.close()
                browser.close()
            except Exception:
                pass
    return out


def main() -> None:
    job = json.loads(sys.stdin.read())
    if job.get("site") and "://" not in job["site"]:
        job["site"] = "http://" + job["site"]
    # Garde réseau (audit C1) : jamais d'adresse interne ni de protocole autre que http(s)
    if not netguard.url_allowed(job.get("site") or "") or (job.get("form_url") and not netguard.url_allowed(job["form_url"])):
        refused = "adresse refusée : ce n'est pas un site web public"
        result = {"send": {"status": "failed", "submitted": False, "filled": {}, "missing": [], "detail": refused},
                  "emails": {"found_email": None, "emails": [], "visited": [], "detail": refused}}.get(
            job.get("mode"), {"status": "unreachable", "filled": {}, "missing": [], "detail": refused})
        sys.stdout.write("\n" + json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return
    if job.get("mode") == "send":
        result = send(job)
    elif job.get("mode") == "prepare":
        result = prepare(job)
    elif job.get("mode") == "emails":
        result = find_emails(job)
    else:
        raise SystemExit("mode inconnu")
    sys.stdout.write("\n" + json.dumps(result, ensure_ascii=False) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
