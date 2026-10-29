"""Ouvre un formulaire préparé dans un Chrome visible, rempli avec ton profil et le message, les champs qui posent
problème encadrés en rouge. Tu complètes et tu envoies toi-même, puis tu fermes la fenêtre.

    .venv/bin/python ouvrir_formulaire.py <site_key>
"""
from __future__ import annotations

import json
import sys

from contact_bot import connect, get_config
from formfill import Sender, fill_form, open_contact_form

HIGHLIGHT_JS = """labels => {
    for (const el of document.querySelectorAll('[data-ff-form] input, [data-ff-form] textarea, [data-ff-form] select')) {
        const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const text = [id && id.innerText, el.placeholder, el.name, el.getAttribute('aria-label')].join(' ');
        if (labels.some(l => l && text.includes(l.replace(/\\s*\\*$/, '').trim()))) {
            el.style.outline = '3px solid red'; el.style.outlineOffset = '2px';
        }
    }
    const first = document.querySelector('[data-ff-form] [style*="outline"]');
    first && first.scrollIntoView({block: 'center'});
}"""


def main(key: str):
    from playwright.sync_api import sync_playwright
    from scraper import USER_AGENT

    db = connect()
    cols = [d[0] for d in db.execute("select * from contacts limit 0").description]
    row = dict(zip(cols, db.execute("select * from contacts where site_key=?", (key,)).fetchone()))
    cfg = get_config(db)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        ctx = browser.new_context(user_agent=USER_AGENT, locale="fr-FR", viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        frame = open_contact_form(page, row["form_url"] or row["site"])
        if frame:
            fill_form(frame, Sender(**cfg["sender"]), row["objet"] or "", row["message"], json.loads(row["extra"] or "{}"))
            try:
                frame.evaluate(HIGHLIGHT_JS, json.loads(row["missing"] or "[]"))
            except Exception:
                pass
        page.bring_to_front()
        page.wait_for_event("close", timeout=0)
        browser.close()


if __name__ == "__main__":
    main(sys.argv[1])
