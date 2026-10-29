"""Traite UN site dans un processus à part (lancé par le runner, coupé net au-delà du délai).

    echo '<json>' | python -m leadmaker_workers.outreach.site_job

Entrée (stdin) : {"mode": "prepare", "site": ..., "sender": {...}, "subject": ..., "body": ..., "short_body": ...,
                  "extra": {...}, "locale": "fr-FR", "headless": true}
Sortie (stdout, dernière ligne) : {"status": ..., "form_url": ..., "filled": {...}, "missing": [...],
                  "detail": ..., "protection_type": ..., "short": bool, "found_email": ..., "screenshot_b64": ...}
"""
from __future__ import annotations

import base64
import json
import os
import sys

from playwright.sync_api import sync_playwright

from ..discovery.scraper import USER_AGENT, _proxy_settings
from .formfill import Sender, best_email, detect_protection, fill_form, open_contact_form

BLOCKED_RESOURCES = ("media", "font")  # les images restent : elles comptent dans la capture


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
    out: dict = {"status": "unreachable", "filled": {}, "missing": [], "detail": ""}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=job.get("headless", True), proxy=_proxy_settings())
        ctx = browser.new_context(user_agent=USER_AGENT, locale=job.get("locale", "en-US"),
                                  viewport={"width": 1280, "height": 900})
        ctx.set_default_timeout(15000)
        ctx.route("**/*", lambda route: route.abort() if route.request.resource_type in BLOCKED_RESOURCES
                  else route.continue_())
        page = ctx.new_page()
        try:
            frame = open_contact_form(page, job["site"], emails=emails)
            if not frame:
                out.update(status="no_form", detail="aucun formulaire de contact trouvé")
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
        except Exception as e:
            out.update(status="unreachable", detail=f"site inaccessible : {type(e).__name__}: {str(e)[:150]}")
        finally:
            out["found_email"] = best_email(job["site"], emails)
            try:
                ctx.close()
                browser.close()
            except Exception:
                pass
    return out


def main() -> None:
    job = json.loads(sys.stdin.read())
    if job.get("mode") != "prepare":
        raise SystemExit("mode inconnu")
    result = prepare(job)
    sys.stdout.write("\n" + json.dumps(result, ensure_ascii=False) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
