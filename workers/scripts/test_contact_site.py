"""Site de test LeadMaker : une page avec un formulaire de contact qui enregistre ce qu'il reçoit.

    python scripts/test_contact_site.py   # http://formulaire-test.localhost:8089/

Pages : /  (formulaire)   /recus (messages reçus)   /vider (efface les messages reçus)
Variantes selon le nom du site (tout *.localhost:8089 répond) : un nom contenant « captcha » affiche un reCAPTCHA
dans le formulaire, un nom contenant « sansform » n'a pas de formulaire (pour tester les cas mis de côté).
Les envois sont stockés dans data/test_contact_received.json. Aucun email n'est envoyé.
"""
from __future__ import annotations

import html
import json
import os
import socket
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs

PORT = int(os.environ.get("TEST_SITE_PORT", "8089"))
STORE = Path(__file__).resolve().parent.parent / "data" / "test_contact_received.json"

PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Plomberie Test — Site de test LeadMaker</title>
<style>body{font-family:sans-serif;max-width:760px;margin:40px auto;padding:0 20px}nav a{margin-right:16px}
label{display:block;margin-top:12px;font-weight:600}input,textarea,select{width:100%;padding:8px;margin-top:4px}
button{margin-top:16px;padding:10px 18px}</style></head><body>
<nav><a href="/">Accueil</a><a href="/#contact">Contact</a><a href="/recus">Messages reçus</a></nav>
<h1>Plomberie Test</h1><p>Site fictif pour tester LeadMaker. Rien n'est envoyé à personne : les messages sont simplement
enregistrés et consultables sur <a href="/recus">Messages reçus</a>.</p>
<h2 id="contact">Contactez-nous</h2>
<form method="post" action="/envoyer">
<label>Civilité<select name="civilite"><option value="">Choisir</option><option>Madame</option><option>Monsieur</option></select></label>
<label>Prénom *<input name="prenom" required></label>
<label>Nom *<input name="nom" required></label>
<label>Société<input name="societe"></label>
<label>Email *<input type="email" name="email" required></label>
<label>Téléphone<input type="tel" name="telephone"></label>
<label>Objet<input name="objet"></label>
<label>Message *<textarea name="message" rows="6" required></textarea></label>
<label><input type="checkbox" name="rgpd" value="oui" required style="width:auto"> J'accepte que mes données soient utilisées pour me répondre *</label>
<label><input type="checkbox" name="newsletter" value="oui" style="width:auto"> Je souhaite recevoir la newsletter</label>
<input type="text" name="website_url" style="display:none" tabindex="-1" autocomplete="off">
<button type="submit">Envoyer le message</button>
</form></body></html>"""

THANKS = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Merci</title></head><body style="font-family:sans-serif;max-width:760px;margin:40px auto">
<div style="background:#e6f7e6;padding:16px;border-radius:8px"><h1>Merci, votre message a bien été envoyé.</h1><p>Nous vous répondrons rapidement.</p></div>
<p><a href="/recus">Voir les messages reçus</a></p></body></html>"""


def load() -> list[dict]:
    try:
        return json.loads(STORE.read_text())
    except Exception:
        return []


class Handler(BaseHTTPRequestHandler):
    def _send(self, body: str, status: int = 200):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/recus":
            rows = load()
            items = "".join(
                f"<li><b>{html.escape(r['recu_le'])}</b> — {html.escape(r.get('prenom',''))} {html.escape(r.get('nom',''))}"
                f" ({html.escape(r.get('email',''))}, {html.escape(r.get('telephone',''))}) — objet : {html.escape(r.get('objet',''))}"
                f"<pre style='white-space:pre-wrap;background:#f4f4f4;padding:8px'>{html.escape(r.get('message',''))}</pre>"
                f"<small>société : {html.escape(r.get('societe',''))} · civilité : {html.escape(r.get('civilite',''))}"
                f" · rgpd : {html.escape(r.get('rgpd',''))} · newsletter : {html.escape(r.get('newsletter',''))}"
                f" · piège anti-robot : {html.escape(r.get('website_url','')) or 'vide (bien)'}</small></li>" for r in reversed(rows))
            self._send(f"<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>Messages reçus</title></head>"
                       f"<body style='font-family:sans-serif;max-width:860px;margin:40px auto'><p><a href='/'>Accueil</a> · "
                       f"<a href='/vider'>Tout effacer</a></p><h1>{len(rows)} message(s) reçu(s)</h1><ul>{items or '<li>Aucun pour l’instant.</li>'}</ul></body></html>")
        elif path == "/vider":
            STORE.write_text("[]")
            self.send_response(302); self.send_header("Location", "/recus"); self.end_headers()
        elif path == "/envoyer":
            self._send(THANKS)
        else:
            host = (self.headers.get("Host") or "").lower()
            if "sansform" in host:
                self._send(PAGE.split('<h2 id="contact">')[0] + "<p>Appelez-nous au 01 23 45 67 89.</p></body></html>")
            elif "captcha" in host:
                self._send(PAGE.replace('<button type="submit">',
                                        '<div class="g-recaptcha" style="width:300px;height:78px;border:1px solid #ccc">reCAPTCHA</div>'
                                        '<button type="submit">'))
            else:
                self._send(PAGE)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        form = parse_qs(self.rfile.read(length).decode("utf-8"), keep_blank_values=True)
        row = {k: v[0] for k, v in form.items()}
        row["recu_le"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        row["site"] = self.headers.get("Host") or ""
        rows = load(); rows.append(row)
        STORE.parent.mkdir(exist_ok=True); STORE.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
        self._send(THANKS)

    def log_message(self, fmt, *args):  # silencieux
        pass


class DualStackServer(HTTPServer):
    """Écoute en IPv6 et IPv4 : les navigateurs résolvent *.localhost en ::1 ou 127.0.0.1 selon le système."""
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    print(f"Site de test sur http://formulaire-test.localhost:{PORT}/ (messages reçus : /recus)")
    DualStackServer(("::", PORT), Handler).serve_forever()
