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
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

from ..discovery.scraper import USER_AGENT, proxy_from_env
from . import netguard
from .formfill import (CONTACT_PATHS, QUOTE_DETAIL, Sender, SiteDown, SiteGone, _check_alive, _contact_links, _dismiss_cookies,
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


def _screenshot(page, frame) -> str:
    try:
        data = frame.locator("[data-ff-form]").first.screenshot(timeout=5000)
    except Exception:
        try:
            data = page.screenshot(full_page=False)
        except Exception:
            return ""
    return base64.b64encode(data).decode("ascii")


# contexte du formulaire choisi pour le contrôle IA (ai_check.py) : titre de la page, 3 derniers titres au-dessus
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
  return {title: document.title, before: [...new Set(heads.slice(-3).map(e => N(e.innerText || e.textContent).slice(0, 100)))],
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
                              short_message=job.get("short_body", ""))
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
                              short_message=job.get("short_body", ""))
                protection = r.protection or detect_protection(frame)
                if protection:
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
                    status = {True: "sent", False: "to_verify", None: "failed"}[ok]
                    out.update(status=status, detail=detail, short=r.short, filled=r.filled,
                               screenshot_b64=_screenshot(page, frame))
        except SiteDown as e:
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
