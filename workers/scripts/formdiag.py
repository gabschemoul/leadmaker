"""Diagnostic d'un site où le robot n'a pas trouvé de formulaire : ce que contient la page d'accueil
(formulaires, champs, iframes, liens « contact ») pour comprendre l'échec.

    .venv/bin/python scripts/formdiag.py https://site.fr/ [https://autre.fr/ ...] [-j 6]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from playwright.sync_api import sync_playwright  # noqa: E402

from leadmaker_workers.discovery.scraper import USER_AGENT  # noqa: E402
from leadmaker_workers.outreach.formfill import _contact_links, _dismiss_cookies, _norm  # noqa: E402

INVENTORY_JS = r"""
() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const desc = el => (el.tagName.toLowerCase() + ':' + (el.type || '') + ':' + (el.name || el.id || el.placeholder || '').slice(0, 25) + (vis(el) ? '' : '(inv)'));
  const forms = [...document.querySelectorAll('form')].map(f => ({
    action: (f.getAttribute('action') || '').slice(0, 60), id: f.id, cls: (f.className || '').toString().slice(0, 40),
    fields: [...f.querySelectorAll('input,textarea,select')].map(desc) }));
  const loose = [...document.querySelectorAll('input:not([type=hidden]),textarea')].filter(e => !e.closest('form')).map(desc);
  const iframes = [...document.querySelectorAll('iframe')].map(i => (i.src || i.getAttribute('data-src') || '').slice(0, 90));
  const text = document.body ? document.body.innerText : '';
  const contactWords = (text.match(/contact|devis|nous [ée]crire/gi) || []).length;
  const buttons = [...document.querySelectorAll('button, a.btn, a.button, [role=button]')].map(b => (b.innerText || '').trim().slice(0, 30)).filter(Boolean).slice(0, 25);
  return { title: document.title, url: location.href, forms, loose, iframes, contactWords, textLen: text.length, buttons,
           links: document.querySelectorAll('a[href]').length };
}
"""


def diag(site: str) -> dict:
    out: dict = {"site": site}
    t0 = time.monotonic()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=USER_AGENT, locale="fr-FR", viewport={"width": 1280, "height": 900},
                                  ignore_https_errors=True)
        ctx.set_default_timeout(15000)
        page = ctx.new_page()
        try:
            page.goto(site, wait_until="domcontentloaded", timeout=25000)
            out["goto_s"] = round(time.monotonic() - t0, 1)
            page.wait_for_timeout(4000)
            _dismiss_cookies(page)
            out.update(page.evaluate(INVENTORY_JS))
            # formulaires dans les iframes (Typeform, Google Forms, Jotform…)
            out["frames"] = []
            for fr in page.frames:
                if fr == page.main_frame:
                    continue
                try:
                    inv = fr.evaluate(INVENTORY_JS)
                    if inv["forms"] or inv["loose"]:
                        out["frames"].append({"url": fr.url[:90], "forms": inv["forms"], "loose": inv["loose"]})
                except Exception:
                    continue
            out["contact_links"] = _contact_links(page, page.url)
            # tous les liens dont le texte ou l'adresse évoque le contact, même hors site
            out["all_contactish"] = page.evaluate("""() => [...document.querySelectorAll('a[href]')]
                .map(a => [a.href.slice(0, 80), (a.innerText || '').trim().slice(0, 30)])
                .filter(([h, t]) => /contact|devis|ecrire|joindre|rdv|rendez/i.test(h + ' ' + t)).slice(0, 10)""")
        except Exception as e:
            out["error"] = f"{type(e).__name__}: {str(e)[:120]}"
        finally:
            browser.close()
    out["seconds"] = round(time.monotonic() - t0, 1)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sites", nargs="+")
    ap.add_argument("-j", "--jobs", type=int, default=6)
    args = ap.parse_args()
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for fut in as_completed([pool.submit(diag, s) for s in args.sites]):
            r = fut.result()
            print("=" * 100)
            print(r["site"], "→", r.get("url", ""), f"[{r.get('seconds')}s]")
            if "error" in r:
                print("  ERREUR", r["error"])
                continue
            print("  titre:", (r.get("title") or "")[:80], "| texte:", r.get("textLen"), "| liens:", r.get("links"),
                  "| mots contact:", r.get("contactWords"))
            for f in r.get("forms", []):
                print("  FORM", f["action"], f["id"], f["cls"], "::", " ".join(f["fields"])[:300])
            if r.get("loose"):
                print("  HORS FORM:", " ".join(r["loose"])[:300])
            for i in r.get("iframes", []):
                print("  IFRAME", i)
            for fr in r.get("frames", []):
                print("  DANS IFRAME", fr["url"])
                for f in fr["forms"]:
                    print("    FORM", f["action"], f["id"], "::", " ".join(f["fields"])[:300])
                if fr["loose"]:
                    print("    HORS FORM:", " ".join(fr["loose"])[:300])
            print("  liens contact retenus:", r.get("contact_links"))
            print("  liens contact (tous):", json.dumps(r.get("all_contactish"), ensure_ascii=False)[:400])
            print("  boutons:", " | ".join(r.get("buttons", []))[:300])


if __name__ == "__main__":
    main()
