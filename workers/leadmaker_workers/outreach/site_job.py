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

from ..discovery.scraper import USER_AGENT, _proxy_settings
from .formfill import (CONTACT_PATHS, Sender, SiteDown, _check_alive, _contact_links, _dismiss_cookies, _same_site, best_email,
                       detect_protection, fill_form, harvest_emails, legal_links, open_contact_form, own_email, submit)

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


def prepare(job: dict) -> dict:
    sender = Sender(**job["sender"])
    emails: set[str] = set()
    visited: list[str] = []
    out: dict = {"status": "unreachable", "filled": {}, "missing": [], "detail": ""}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=job.get("headless", True), proxy=_proxy_settings())
        ctx = browser.new_context(user_agent=USER_AGENT, locale=job.get("locale", "en-US"),
                                  viewport={"width": 1280, "height": 900},
                                  ignore_https_errors=True)  # certificats expirés : on visite quand même (choix de Gabriel)
        ctx.set_default_timeout(15000)
        ctx.route("**/*", lambda route: route.abort() if route.request.resource_type in BLOCKED_RESOURCES
                  else route.continue_())
        page = ctx.new_page()
        _arm_watchdog()
        try:
            frame = open_contact_form(page, job["site"], emails=emails, visited=visited)
            if not frame:
                out.update(status="no_form", detail="aucun formulaire de contact trouvé (pages vues : "
                           + ", ".join(dict.fromkeys(visited)) + ")")
            else:
                r = fill_form(frame, sender, job.get("subject", ""), job["body"], job.get("extra") or {},
                              short_message=job.get("short_body", ""))
                protection = r.protection or detect_protection(frame)
                if protection:
                    status = "intervention_required"
                elif r.status == "error":
                    status = "failed"
                elif r.missing:
                    status = "incomplete"
                else:
                    status = "ready"
                detail = "; ".join(filter(None, [r.detail] + r.warnings))
                if protection and not r.detail:
                    detail = "; ".join(filter(None, [f"protection anti-robot : {protection}", detail]))
                out.update(status=status, form_url=r.form_url, filled=r.filled, missing=r.missing, detail=detail,
                           protection_type=protection, short=r.short, screenshot_b64=_screenshot(page, frame))
        except SiteDown as e:
            out.update(status="unreachable", detail=f"site hors ligne ou en construction (« {e} »)")
        except SiteHang as e:
            out.update(status="unreachable", detail=f"site bloqué : {e} (pages vues : " + ", ".join(dict.fromkeys(visited)) + ")")
            _finish_now(out, job["site"], emails, visited)
        except Exception as e:
            out.update(status="unreachable", detail=f"site inaccessible : {type(e).__name__}: {str(e)[:150]}")
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
        browser = pw.chromium.launch(headless=job.get("headless", True), proxy=_proxy_settings())
        ctx = browser.new_context(user_agent=USER_AGENT, locale=job.get("locale", "en-US"),
                                  viewport={"width": 1280, "height": 900},
                                  ignore_https_errors=True)  # certificats expirés : on visite quand même (choix de Gabriel)
        ctx.set_default_timeout(15000)
        page = ctx.new_page()
        try:
            frame = open_contact_form(page, job.get("form_url") or job["site"])
            if not frame and job.get("form_url"):
                frame = open_contact_form(page, job["site"])
            if not frame:
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
        browser = pw.chromium.launch(headless=job.get("headless", True), proxy=_proxy_settings())
        ctx = browser.new_context(user_agent=USER_AGENT, locale=job.get("locale", "en-US"),
                                  viewport={"width": 1280, "height": 900}, ignore_https_errors=True)
        ctx.set_default_timeout(15000)
        ctx.route("**/*", lambda route: route.abort() if route.request.resource_type in ("image", "media", "font")
                  else route.continue_())
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
