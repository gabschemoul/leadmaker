"""Bot de contact : prépare les formulaires de contact des fiches opt-in du Google Sheet, puis envoie
uniquement ceux que l'utilisateur a validés dans le dashboard (page « Formulaires »).

Cycle d'une fiche : à valider → (validation manuelle) à envoyer → envoyé / à vérifier / échec envoi
Autres statuts : pas de formulaire, captcha, site inaccessible, erreur, passé, ne jamais contacter.

Lancement : depuis le dashboard, ou  caffeinate -is .venv/bin/python contact_bot.py
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import re
import signal
import sqlite3
import sys
import subprocess
import threading
import uuid
import time
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
DB_PATH = Path(os.environ.get("GMB_CONTACT_DB", DATA / "contact.db"))
LOG_PATH = DB_PATH.with_suffix(".log")
SHOTS = DATA / "contact_shots"
SETTINGS = ROOT / ".settings.json"
SHEET_TAB = "Scan auto"
SHEET_COLS = ["Opt-in", "Statut contact", "Date contact", "Modèle", "Réponse"]
ANALYTICS_TAB = "Analytics"
REPONSES = ["intéressé", "pas intéressé", "STOP"]

# Version US : messages en anglais. Profil et modèles repris de la version française (modifiables dans l'interface).
TEMPLATES_EN = [
    {"nom": "Template 1", "objet": "Your Google Business rating",
     "message": "Hello,\n\nWe took a look at your Google Business profile and noticed several negative reviews that are "
                "hurting your online reputation.\n\nReview Cleaner specializes in removing negative reviews from Google. "
                "We can take care of these reviews and handle the entire removal process for you.\n\n"
                "Would this be of interest to you?\n\nThank you,\nThe Review Cleaner Team"},
    {"nom": "Template 2", "objet": "We can remove your negative Google reviews",
     "message": "Hello,\n\nWhile looking at your business on Google, we noticed that several negative reviews are "
                "lowering your rating and are still visible to your future customers.\n\nReview Cleaner can take care "
                "of removing them and handle all the steps involved.\n\nWould you like us to work on these reviews?\n\n"
                "Thank you,\nThe Review Cleaner Team\nwww.reviewcleaner.com"},
    {"nom": "Template 3", "objet": "Your Google reviews are driving customers away",
     "message": "Hello,\n\nWe found several negative reviews on your Google Business profile.\n\nAt Review Cleaner, "
                "our job is to help businesses get them removed and protect their online reputation.\n\nWe can take care "
                "of your situation directly. Would this be of interest to you?\n\nThank you,\nThe Review Cleaner Team"},
    {"nom": "Template 4", "objet": "We found negative reviews on your Google profile",
     "message": "Hello,\n\nWe took a look at your Google Business profile, and several negative reviews are currently "
                "hurting your rating and your image with potential customers.\n\nReview Cleaner specializes in removing "
                "negative reviews from Google. We can handle the entire process for your business.\n\nYou'll find all the "
                "details on our website. We can start working on your case within 24 hours.\n\nThank you,\n"
                "The Review Cleaner Team\nwww.reviewcleaner.com"},
]
DEFAULT_CONFIG = {
    "sender": {"prenom": "Laurie", "nom": "Wang", "societe": "Review Cleaner", "email": "laurie@review-cleaner.com",
               "telephone": "+33 7 80 97 92 69", "site": "https://review-cleaner.com/", "ville": "Paris",
               "code_postal": "75012", "adresse": "17 rue Mansard", "pays": "France",
               "civilite": "Ms.", "fonction": "Google Manager"},
    "templates": TEMPLATES_EN,
    "daily_limit": 500,
    "prepare_ahead": 1500,
    "headless": True,
    "workers": 5,      # onglets qui préparent des formulaires en parallèle
    "short_template": "",  # modèle utilisé quand la zone de message est limitée (vide = le plus court)
    "start_row": 2,    # première ligne du Sheet à traiter
}
VARIABLES = {
    "{entreprise}": "nom de l'entreprise", "{ville}": "ville", "{categorie}": "catégorie Google",
    "{note}": "note Google", "{nb_avis}": "nombre d'avis", "{site}": "site de l'entreprise",
    "{prenom}": "ton prénom", "{nom}": "ton nom", "{societe}": "ta société", "{email}": "ton email",
    "{telephone}": "ton téléphone", "{mon_site}": "ton site",
}
FINAL = {"envoyé", "à vérifier", "échec envoi", "pas de formulaire", "captcha", "site inaccessible", "erreur",
         "passé", "ne jamais contacter"}
SYNCED = FINAL | {"à valider"}
RETRY = "nouvel essai après délai dépassé"
SITE_TIMEOUT = 45  # secondes max par site : au-delà, on coupe et on passe au suivant  # statuts reportés dans le Sheet

SCHEMA = """
create table if not exists contacts (
    site_key text primary key, maps_link text, nom text, site text, ville text, categorie text, note real,
    nb_avis integer, status text, template text, objet text, message text, form_url text, shot text,
    shot_after text, detail text, filled text, prepared_at text, sent_at text, sheet_synced integer default 0
);
create table if not exists state (key text primary key, value text);
"""


# ---------------------------------------------------------------- Base (partagée avec le dashboard)
def connect() -> sqlite3.Connection:
    DATA.mkdir(exist_ok=True)
    SHOTS.mkdir(exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    db.execute("pragma journal_mode=wal")
    db.executescript(SCHEMA)
    have = {r[1] for r in db.execute("pragma table_info(contacts)")}
    for col in ("missing", "extra"):  # champs obligatoires non remplis / valeurs saisies à la main (JSON)
        if col not in have:
            db.execute(f"alter table contacts add column {col} text")
    return db


def get_state(db, key, default=None):
    row = db.execute("select value from state where key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def set_state(db, **kw):
    for k, v in kw.items():
        db.execute("insert or replace into state values (?, ?)", (k, json.dumps(v)))


def get_config(db) -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG)) | (get_state(db, "config") or {})
    cfg["sender"] = DEFAULT_CONFIG["sender"] | cfg.get("sender", {})
    return cfg


def bot_alive(db) -> bool:
    pid = get_state(db, "pid")
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return time.time() - (get_state(db, "heartbeat") or 0) < 600


def sent_today(db) -> int:
    return db.execute("select count(*) from contacts where status in ('envoyé', 'à vérifier', 'échec envoi') "
                      "and sent_at >= ?", (date.today().isoformat(),)).fetchone()[0]


def template_problems(t: dict, sender: dict) -> list[str]:
    """Contrôle obligatoire d'un modèle rempli : l'expéditeur doit être identifiable.
    (Pas de phrase de désinscription exigée : les contacts disposent déjà d'un moyen de refus par email.)"""
    if not t.get("message", "").strip():
        return []
    issues = []
    if "{societe}" not in t["message"] and (not sender.get("societe") or sender["societe"] not in t["message"]):
        issues.append("ta société doit apparaître dans le message (variable {societe})")
    return issues


def short_version(cfg: dict, row: dict) -> tuple[str, str, str] | None:
    """(nom, objet, message) du modèle court, pour les zones de message limitées en caractères."""
    usable = [t for t in cfg["templates"] if t["message"].strip()]
    t = next((t for t in usable if t["nom"] == cfg.get("short_template")), None) or (
        min(usable, key=lambda t: len(t["message"])) if usable else None)  # sinon : le modèle le plus court
    if not t:
        return None
    return t["nom"], render(t.get("objet", ""), row, cfg["sender"]), render(t["message"], row, cfg["sender"])


def render(text: str, row: dict, sender: dict) -> str:
    values = {
        "{entreprise}": row.get("nom") or "", "{ville}": row.get("ville") or "", "{categorie}": row.get("categorie") or "",
        "{note}": (f"{row['note']:.1f}" if row.get("note") is not None else ""),
        "{nb_avis}": str(row.get("nb_avis") or ""), "{site}": row.get("site") or "",
        "{prenom}": sender["prenom"], "{nom}": sender["nom"], "{societe}": sender["societe"],
        "{email}": sender["email"], "{telephone}": sender["telephone"], "{mon_site}": sender["site"],
    }
    for k, v in values.items():
        text = text.replace(k, v)
    return text


# ---------------------------------------------------------------- Google Sheet
def open_sheet():
    import gspread

    settings = json.loads(SETTINGS.read_text())
    creds = ROOT / settings.get("creds_path", "credentials.json")  # chemin relatif au dossier du projet
    return gspread.service_account(filename=str(creds)).open_by_url(settings["sheet_url"]).worksheet(SHEET_TAB)


def _hkey(h: str) -> str:
    """« Opt-in », « Optin », « OPT IN » → « optin »."""
    return re.sub(r"[^a-z0-9]", "", h.strip().lower().replace("è", "e").replace("é", "e"))


def ensure_columns(ws) -> dict[str, int]:
    """Ajoute si besoin les colonnes Opt-in / Statut contact / Date contact / Modèle.
    Renvoie {en-tête normalisé: n° colonne} (ex. « optin », « statutcontact », « lienGoogleMaps » → « liengooglemaps »)."""
    header = ws.row_values(1)
    norm = [_hkey(h) for h in header]
    for col in SHEET_COLS:
        if _hkey(col) not in norm:
            header.append(col)
            norm.append(_hkey(col))
            if len(header) > ws.col_count:
                ws.add_cols(len(header) - ws.col_count)
            ws.update_cell(1, len(header), col)
    return {k: i + 1 for i, k in enumerate(norm)}


def write_analytics(ws, template_names: list[str]):
    """Onglet « Analytics » : statistiques par modèle, calculées par formules (toujours à jour dans le Sheet).
    Ajoute aussi la liste déroulante intéressé / pas intéressé / STOP sur la colonne « Réponse »."""
    from gspread.utils import rowcol_to_a1, ValidationConditionType

    cols = ensure_columns(ws)
    letter = lambda key: re.sub(r"\d", "", rowcol_to_a1(1, cols[key]))  # noqa: E731
    src = f"'{ws.title}'!"
    m, s, r = (f"{src}{letter(k)}:{letter(k)}" for k in ("modele", "statutcontact", "reponse"))
    rep = letter("reponse")
    ws.add_validation(f"{rep}2:{rep}{ws.row_count}", ValidationConditionType.one_of_list, REPONSES,
                      showCustomUi=True, strict=False)

    book = ws.spreadsheet
    try:
        an = book.worksheet(ANALYTICS_TAB)
    except Exception:
        an = book.add_worksheet(ANALYTICS_TAB, rows=30, cols=9)
    header = ["Modèle", "Envoyés", "Réponses", "Taux de réponse", "Intéressés", "Taux d'intérêt", "STOP",
              "Non confirmés (à vérifier)", "Échecs d'envoi"]
    rows = [header]
    for i, name in enumerate(template_names, start=2):
        rows.append([
            name,
            f'=NB.SI.ENS({m};A{i};{s};"envoyé")+NB.SI.ENS({m};A{i};{s};"à vérifier")',
            f'=NB.SI.ENS({m};A{i};{r};"<>")',
            f'=SI(B{i}=0;"";C{i}/B{i})',
            f'=NB.SI.ENS({m};A{i};{r};"intéressé")',
            f'=SI(B{i}=0;"";E{i}/B{i})',
            f'=NB.SI.ENS({m};A{i};{r};"STOP")',
            f'=NB.SI.ENS({m};A{i};{s};"à vérifier")',
            f'=NB.SI.ENS({m};A{i};{s};"échec envoi")',
        ])
    last = len(rows)
    rows.append(["TOTAL", f"=SOMME(B2:B{last})", f"=SOMME(C2:C{last})", f'=SI(B{last + 1}=0;"";C{last + 1}/B{last + 1})',
                 f"=SOMME(E2:E{last})", f'=SI(B{last + 1}=0;"";E{last + 1}/B{last + 1})', f"=SOMME(G2:G{last})",
                 f"=SOMME(H2:H{last})", f"=SOMME(I2:I{last})"])
    an.clear()
    an.update(rows, "A1", value_input_option="USER_ENTERED")
    an.format("A1:I1", {"textFormat": {"bold": True}})
    an.format(f"A{last + 1}:I{last + 1}", {"textFormat": {"bold": True}})
    an.format(f"D2:D{last + 1}", {"numberFormat": {"type": "PERCENT", "pattern": "0.0%"}})
    an.format(f"F2:F{last + 1}", {"numberFormat": {"type": "PERCENT", "pattern": "0.0%"}})
    an.freeze(rows=1)
    an.update([["Remplis la colonne « Réponse » de l'onglet « " + ws.title + " » quand une entreprise répond "
                "(intéressé / pas intéressé / STOP) : les taux se mettent à jour tout seuls."]], f"A{last + 3}")


def read_optin_rows(ws) -> list[dict]:
    """Lignes du Sheet avec Opt-in = oui et un site web."""
    values = ws.get_all_values()
    if not values:
        return []
    idx = {_hkey(h): i for i, h in enumerate(values[0])}
    get = lambda r, h: r[idx[_hkey(h)]].strip() if _hkey(h) in idx and idx[_hkey(h)] < len(r) else ""  # noqa: E731
    rows = []
    for n, r in enumerate(values[1:], 2):
        if get(r, "opt-in").lower() not in ("oui", "yes", "o", "x"):
            continue
        site = get(r, "site web")
        if not site or get(r, "statut contact"):  # déjà traité (par le bot ou à la main)
            continue
        adresse = get(r, "adresse")
        m = re.search(r"\b\d{5}\s+([^,]+)", adresse)
        note = get(r, "note").replace(",", ".")
        rows.append({
            "ligne": n, "nom": get(r, "nom"), "categorie": get(r, "catégorie"), "site": site, "maps_link": get(r, "lien google maps"),
            "ville": m.group(1).strip() if m else "", "adresse": adresse,
            "note": float(note) if re.fullmatch(r"\d+(\.\d+)?", note) else None,
            "nb_avis": int(get(r, "nb avis")) if get(r, "nb avis").isdigit() else None,
        })
    return rows


def write_back(db, log: logging.Logger):
    """Reporte statut / date / modèle dans le Sheet (ligne retrouvée par le lien Google Maps)."""
    todo = db.execute("select site_key, maps_link, status, coalesce(sent_at, prepared_at), template from contacts "
                      "where sheet_synced=0 and status in (%s)" % ",".join("?" * len(SYNCED)), tuple(SYNCED)).fetchall()
    if not todo:
        return
    ws = open_sheet()
    cols = ensure_columns(ws)
    links = ws.col_values(cols["liengooglemaps"])
    row_of = {l: i + 1 for i, l in enumerate(links)}
    from gspread.utils import rowcol_to_a1

    updates, done = [], []
    for key, link, status, ts, template in todo:
        r = row_of.get(link)
        if r:
            for col, val in (("Statut contact", status), ("Date contact", (ts or "")[:16].replace("T", " ")),
                             ("Modèle", template or "")):
                updates.append({"range": rowcol_to_a1(r, cols[_hkey(col)]), "values": [[val]]})
        done.append((key,))
    if updates:
        ws.batch_update(updates, value_input_option="RAW")
    db.executemany("update contacts set sheet_synced=1 where site_key=?", done)
    log.info("Sheet : %d statuts mis à jour", len(done))


# ---------------------------------------------------------------- Bot
class Browser:
    """Un navigateur Chrome (un par onglet de travail), rouvert si l'interrupteur visible/invisible change."""

    def __init__(self):
        self.pw = self.browser = self.ctx = None
        self.headless = None
        self.killed = False
        self.marker = f"--ff-tab={uuid.uuid4().hex[:10]}"  # repère pour tuer ce Chrome s'il se bloque

    def kill(self):
        """Tue ce Chrome (appelé depuis un autre thread) : l'appel bloqué lève alors une erreur."""
        self.killed = True
        subprocess.run(["pkill", "-f", self.marker.lstrip("-")], capture_output=True)

    def open(self, cfg):
        from playwright.sync_api import sync_playwright
        from scraper import USER_AGENT

        if self.ctx and self.headless == cfg["headless"] and not self.killed and self.browser.is_connected():
            return self.ctx
        self.close()
        self.headless, self.killed = cfg["headless"], False
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(headless=cfg["headless"], args=[self.marker])
        self.ctx = self.browser.new_context(user_agent=USER_AGENT, locale="fr-FR", viewport={"width": 1280, "height": 900})
        self.ctx.set_default_timeout(15000)
        return self.ctx

    def close(self):
        for o in (self.ctx, self.browser):
            try:
                o and o.close()
            except Exception:
                pass
        if self.pw:
            try:
                self.pw.stop()
            except Exception:
                pass
        self.pw = self.browser = self.ctx = None


def get_logger() -> logging.Logger:
    log = logging.getLogger("contact")
    if not log.handlers:
        log.setLevel(logging.INFO)
        h = logging.FileHandler(LOG_PATH, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(message)s", "%Y-%m-%d %H:%M:%S"))
        log.addHandler(h)
    return log


def run_site(task: dict):
    """Traite un seul site (préparation ou envoi) dans un processus à part : `python contact_bot.py --site`.
    Le bot tue ce processus s'il dépasse SITE_TIMEOUT, même si le site bloque complètement."""
    bot = ContactBot.__new__(ContactBot)
    bot.log = get_logger()
    db, br = connect(), Browser()
    try:
        ctx = br.open(task["cfg"])
        if task["mode"] == "send":
            bot.send(task["key"], task["cfg"], ctx, db)
        else:
            bot.prepare(task["row"], task["cfg"], ctx, db)
    finally:
        br.close()


class ContactBot:
    def __init__(self):
        self.db = connect()
        self.log = get_logger()
        self.candidates: list[dict] = []
        self.lock = threading.Lock()
        self.in_flight: dict[str, str] = {}  # site en cours de préparation -> lien Maps
        self.tabs: dict[int, str] = {}  # onglet -> fiche en cours
        self.stopping = False
        self.last_sheet = self.last_write = 0.0
        signal.signal(signal.SIGTERM, lambda *_: set_state(self.db, control="stop"))

    def beat(self, **kw):
        set_state(self.db, heartbeat=time.time(), pid=os.getpid(), **kw)

    def control(self) -> str:
        return get_state(self.db, "control", "run")

    # -- file d'attente depuis le Sheet
    def refresh_candidates(self, cfg):
        from crawler import connect as scan_connect, get_config as scan_config, is_chain_site, make_exclude
        from sites import site_key

        ws = open_sheet()
        ensure_columns(ws)
        if not get_state(self.db, "analytics_done"):
            write_analytics(ws, [t["nom"] for t in cfg["templates"] if t["message"].strip()])
            set_state(self.db, analytics_done=True)
        rows = read_optin_rows(ws)
        sdb = scan_connect()
        base = make_exclude(scan_config(sdb))
        exclude = lambda nom, cat, site: (base and base(nom, cat, site)) or is_chain_site(sdb, site)  # noqa: E731
        links = dict(self.db.execute("select site_key, maps_link from contacts").fetchall())
        with self.lock:
            links |= {k: l for k, l in self.in_flight.items()}
        done = set(links)
        out, seen, marks = [], set(), []
        for r in rows:
            if r["ligne"] < cfg["start_row"]:
                continue
            k = site_key(r["site"])
            if not k or k in done or k in seen:
                if links.get(k) != r["maps_link"]:  # la fiche elle-même : statut reporté par write_back
                    marks.append((r["ligne"], "doublon (même site)"))
                continue
            if exclude(r["nom"], r["categorie"], r["site"]):
                marks.append((r["ligne"], "exclu"))
                continue
            seen.add(k)
            out.append(r | {"site_key": k})
        if marks:  # lignes non traitées : on l'indique aussi dans le Sheet
            from gspread.utils import rowcol_to_a1

            cols, now = ensure_columns(ws), datetime.now().strftime("%Y-%m-%d %H:%M")
            ws.batch_update([{"range": f"{rowcol_to_a1(n, cols['statutcontact'])}:{rowcol_to_a1(n, cols['datecontact'])}",
                              "values": [[st, now]]} for n, st in marks], value_input_option="RAW")
            self.log.info("Sheet : %d lignes marquées doublon / exclu", len(marks))
        with self.lock:
            self.candidates = out
        set_state(self.db, optin_total=len(rows), queue=len(out), sheet_read_at=time.time())
        self.log.info("Sheet lu : %d fiches opt-in, %d à préparer", len(rows), len(out))

    def pick_template(self, cfg, db) -> tuple[str, dict] | None:
        usable = [t for t in cfg["templates"] if t.get("message", "").strip()
                  and not template_problems(t, cfg["sender"])]
        if not usable:
            return None
        counts = dict(db.execute("select template, count(*) from contacts group by template").fetchall())
        least = min(counts.get(t["nom"], 0) for t in usable)
        t = random.choice([t for t in usable if counts.get(t["nom"], 0) == least])
        return t["nom"], t

    def _shot(self, page, frame, key: str, suffix: str) -> str:
        path = SHOTS / f"{hashlib.md5(key.encode()).hexdigest()[:12]}{suffix}.png"
        try:
            frame.locator("[data-ff-form]").first.screenshot(path=str(path), timeout=5000)
        except Exception:
            page.screenshot(path=str(path), full_page=False)
        return str(path)

    # -- préparation (remplissage sans envoi)
    def prepare(self, row: dict, cfg, ctx, db):
        from formfill import Sender, fill_form, has_captcha, open_contact_form

        picked = self.pick_template(cfg, db)
        if not picked:
            time.sleep(10)
            return
        tname, t = picked
        sender = Sender(**cfg["sender"])
        objet, message = render(t.get("objet", ""), row, cfg["sender"]), render(t["message"], row, cfg["sender"])
        base = {k: row.get(k) for k in ("site_key", "maps_link", "nom", "site", "ville", "categorie", "note", "nb_avis")}
        now = datetime.now().isoformat(timespec="seconds")
        page = ctx.new_page()
        try:
            frame = open_contact_form(page, row["site"])
            if not frame:
                rec = base | {"status": "pas de formulaire", "detail": "aucun formulaire de contact trouvé"}
            else:
                short = short_version(cfg, row)
                r = fill_form(frame, sender, objet, message, short_message=short[2] if short else "")
                if r.short:
                    tname, objet, message = short
                captcha = r.status == "captcha" or has_captcha(frame)
                status = "captcha" if captcha else ("à valider" if r.status == "rempli" else "erreur")
                warn = "; ".join(filter(None, [r.detail] + [f"champ obligatoire non rempli : {u}" for u in r.unknown_required]))
                rec = base | {"status": status, "form_url": r.form_url, "detail": warn, "filled": json.dumps(r.filled, ensure_ascii=False),
                              "missing": json.dumps(r.missing, ensure_ascii=False) if r.missing else None,
                              "shot": self._shot(page, frame, row["site_key"], "")}
        except Exception as e:
            rec = base | {"status": "site inaccessible", "detail": f"{type(e).__name__}: {str(e)[:150]}"}
        finally:
            page.close()
        rec |= {"template": tname, "objet": objet, "message": message, "prepared_at": now}
        cols = ", ".join(rec)
        db.execute(f"insert or replace into contacts ({cols}) values ({', '.join('?' * len(rec))})", tuple(rec.values()))
        self.log.info("Préparé (ligne %s) : %s → %s", row.get("ligne"), row["nom"], rec["status"])

    # -- envoi d'une fiche validée
    def claim_send(self, db, cfg) -> str | None:
        """Réserve un formulaire validé à envoyer (plusieurs onglets envoient en parallèle)."""
        db.execute("begin immediate")
        try:
            busy = db.execute("select count(*) from contacts where status='envoi en cours'").fetchone()[0]
            if sent_today(db) + busy >= cfg["daily_limit"]:
                return None
            row = db.execute("select site_key from contacts where status='à envoyer' order by prepared_at limit 1").fetchone()
            if row:
                db.execute("update contacts set status='envoi en cours' where site_key=?", row)
            return row and row[0]
        finally:
            db.execute("commit")

    def send(self, key: str, cfg, ctx, db):
        from formfill import Sender, fill_form, has_captcha, open_contact_form, submit

        row = dict(zip([d[0] for d in db.execute("select * from contacts limit 0").description],
                       db.execute("select * from contacts where site_key=?", (key,)).fetchone()))
        page = ctx.new_page()
        now = datetime.now().isoformat(timespec="seconds")
        submitted = False
        try:
            frame = open_contact_form(page, row["form_url"] or row["site"])
            if not frame:
                upd = {"status": "échec envoi", "detail": "formulaire introuvable au moment de l'envoi"}
            else:
                short = short_version(cfg, row)
                r = fill_form(frame, Sender(**cfg["sender"]), row["objet"], row["message"], json.loads(row["extra"] or "{}"),
                              short_message=short[2] if short else "")
                if r.status == "captcha" or has_captcha(frame):
                    upd = {"status": "captcha", "detail": "captcha apparu au moment de l'envoi"}
                elif r.status != "rempli":
                    upd = {"status": "échec envoi", "detail": r.detail}
                elif r.missing:  # le site refuserait l'envoi : retour dans « À compléter »
                    upd = {"status": "à valider", "missing": json.dumps(r.missing, ensure_ascii=False),
                           "detail": "; ".join(f"champ obligatoire non rempli : {u}" for u in r.unknown_required)}
                else:
                    submitted = True
                    ok, detail = submit(frame)
                    upd = {"status": {True: "envoyé", False: "à vérifier", None: "échec envoi"}[ok], "detail": detail,
                           "shot_after": self._shot(page, frame, key, "_apres")}
                    if r.short:  # le message court est parti : c'est lui qui compte dans l'Analytics
                        upd |= dict(zip(("template", "objet", "message"), short))
        except Exception as e:
            upd = {"status": "échec envoi", "detail": f"{type(e).__name__}: {str(e)[:150]}"}
            if not submitted and not (row["detail"] or "").startswith(RETRY):  # site lent : un seul nouvel essai
                upd = {"status": "à envoyer", "detail": f"{RETRY} ({type(e).__name__})"}
        finally:
            page.close()
        if upd["status"] == "à envoyer":
            db.execute("update contacts set status=?, detail=? where site_key=?", (upd["status"], upd["detail"], key))
            self.log.info("Envoi : %s → nouvel essai plus tard (%s)", row["nom"], upd["detail"])
            return
        upd |= {"sent_at": now, "sheet_synced": 0} if upd["status"] != "à valider" else {}
        db.execute(f"update contacts set {', '.join(f'{k}=?' for k in upd)} where site_key=?", (*upd.values(), key))
        self.log.info("Envoi : %s → %s (%s)", row["nom"], upd["status"], upd.get("detail", ""))

    # -- onglets de préparation (en parallèle, chacun son navigateur)
    def next_candidate(self) -> dict | None:
        with self.lock:
            if not self.candidates:
                return None
            row = self.candidates.pop(0)
            self.in_flight[row["site_key"]] = row["maps_link"]
            return row

    def run_isolated(self, task: dict) -> bool:
        """Lance le site dans un processus à part ; False s'il a fallu le couper (bloqué trop longtemps)."""
        proc = subprocess.Popen([sys.executable, __file__, "--site"], stdin=subprocess.PIPE, cwd=ROOT,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            proc.communicate(json.dumps(task).encode(), timeout=SITE_TIMEOUT)
            return True
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)  # python + Chrome du site
            except OSError:
                pass
            proc.wait()
            return False

    def prep_tab(self, i: int):
        db = connect()
        while not self.stopping:
            try:
                cfg = get_config(db)
                active = get_state(db, "control", "run") == "run" and i < cfg["workers"]
                key = active and self.claim_send(db, cfg)
                if key:  # les formulaires validés passent avant la préparation
                    self.tabs[i] = "envoi"
                    if not self.run_isolated({"mode": "send", "key": key, "cfg": cfg}):
                        db.execute("update contacts set status='à vérifier', sent_at=?, sheet_synced=0, "
                                   "detail='envoi bloqué plus de %d s : vérifie sur le site' where site_key=?"
                                   % SITE_TIMEOUT, (datetime.now().isoformat(timespec="seconds"), key))
                        self.log.info("Envoi coupé après %d s : %s", SITE_TIMEOUT, key)
                    # sécurité : processus mort sans rien écrire
                    db.execute("update contacts set status='à envoyer' where site_key=? and status='envoi en cours'", (key,))
                    continue
                waiting = db.execute("select count(*) from contacts where status='à valider'").fetchone()[0]
                row = None
                if active and waiting < cfg["prepare_ahead"] and self.pick_template(cfg, db):
                    row = self.next_candidate()
                if not row:
                    self.tabs.pop(i, None)
                    time.sleep(5)
                    continue
                self.tabs[i] = f"ligne {row['ligne']} {row['nom']}"
                try:
                    if not self.run_isolated({"mode": "prepare", "row": row, "cfg": cfg}):
                        rec = {k: row.get(k) for k in ("site_key", "maps_link", "nom", "site", "ville", "categorie", "note", "nb_avis")}
                        rec |= {"status": "site inaccessible", "detail": f"bloqué plus de {SITE_TIMEOUT} s : passé au suivant",
                                "prepared_at": datetime.now().isoformat(timespec="seconds")}
                        db.execute(f"insert or replace into contacts ({', '.join(rec)}) values ({', '.join('?' * len(rec))})",
                                   tuple(rec.values()))
                        self.log.info("Préparé (ligne %s) : %s → coupé après %d s", row["ligne"], row["nom"], SITE_TIMEOUT)
                finally:
                    with self.lock:
                        self.in_flight.pop(row["site_key"], None)
            except Exception as e:
                self.log.warning("Onglet %d : %s (%s)", i + 1, type(e).__name__, str(e)[:150])
                time.sleep(5)

    def run(self):
        set_state(self.db, pid=os.getpid(), control="run")
        self.db.execute("update contacts set status='à envoyer' where status='envoi en cours'")  # arrêt en plein envoi
        self.beat(status="démarrage…")
        self.log.info("Démarrage du bot de contact (pid %d)", os.getpid())
        tabs = []
        try:
            while True:
                ctl = self.control()
                if ctl == "stop":
                    break
                cfg = get_config(self.db)
                for i in range(len(tabs), cfg["workers"]):  # onglets ajoutés à la volée
                    tabs.append(threading.Thread(target=self.prep_tab, args=(i,), daemon=True))
                    tabs[-1].start()
                if ctl == "pause":
                    self.beat(status="en pause", current=None)
                    time.sleep(5)
                    continue

                if time.time() - self.last_write > 120:
                    self.last_write = time.time()
                    try:
                        write_back(self.db, self.log)
                    except Exception as e:
                        self.log.warning("Écriture Sheet impossible : %s", e)

                with self.lock:
                    empty = not self.candidates
                if empty and time.time() - self.last_sheet > 120 or time.time() - self.last_sheet > 180:
                    self.last_sheet = time.time()
                    try:
                        self.refresh_candidates(cfg)
                    except Exception as e:
                        self.log.warning("Lecture du Sheet impossible : %s", e)

                to_send = self.db.execute("select count(*) from contacts where status='à envoyer'").fetchone()[0]
                waiting = self.db.execute("select count(*) from contacts where status='à valider'").fetchone()[0]
                busy = sorted(self.tabs.items())
                if to_send and sent_today(self.db) >= cfg["daily_limit"]:
                    status = f"limite du jour atteinte ({cfg['daily_limit']}) : envois repris demain"
                elif busy:
                    status = f"{len(busy)} onglet(s) actif(s)" + (f" · {to_send} envoi(s) en file" if to_send else "")
                elif waiting >= cfg["prepare_ahead"]:
                    status = f"en attente de ta validation ({waiting} formulaires prêts)"
                elif empty:
                    status = f"aucune fiche à préparer à partir de la ligne {cfg['start_row']}"
                else:
                    status = "en cours"
                self.beat(status=status, current=" · ".join(f"#{i + 1} {n}" for i, n in busy) or None,
                          queue=len(self.candidates))
                time.sleep(3)
        finally:
            self.stopping = True
            for t in tabs:
                t.join(timeout=60)
            try:
                write_back(self.db, self.log)
            except Exception:
                pass
            if get_state(self.db, "pid") == os.getpid():  # un autre bot a pu être relancé entre-temps
                set_state(self.db, pid=None, status="arrêté", current=None)
            self.log.info("Bot de contact arrêté")

if __name__ == "__main__":
    if sys.argv[1:] == ["--site"]:
        run_site(json.loads(sys.stdin.read()))
    else:
        ContactBot().run()
