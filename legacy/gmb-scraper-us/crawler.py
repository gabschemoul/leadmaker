"""Scan automatique continu de Google Maps — version US : toutes les catégories × toutes les villes des États-Unis.

Lancé et piloté depuis le dashboard (page « Scan automatique »). Peut aussi tourner seul :
    caffeinate -is .venv/bin/python crawler.py --worker 0   (un processus = un onglet ; lancer 0, 1, … en parallèle)

Tout l'état (fiches, progression, réglages, commandes) est dans data/scan.db : le scan reprend
exactement où il s'était arrêté.
"""
from __future__ import annotations

import json
import logging
import os
import random
import signal
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
DB_PATH = Path(os.environ.get("GMB_SCAN_DB", DATA / "scan.db"))
LOG_PATH = DB_PATH.with_suffix(".log")
ZONES_PATH = DATA / "zones.json"
SETTINGS = ROOT / ".settings.json"
SHEET_TAB = "Scan auto"

DEFAULT_CONFIG = {
    "rating_min": 0.8,
    "rating_max": 3.5,
    "min_reviews": 1,
    "website": "with",
    "target": 50000,
    "stop_at_target": False,
    "max_results": 120,
    "delay": 1.5,
    "headless": True,
    "sheets_every_min": 10,
    "workers": 2,
    "exclude_public_banks": True,
    "extra_exclusions": "",
}

# Vagues : (catégories, population min, population max). G = générales, S = toutes les autres.
TIERS = [
    ("G", 20000, None), ("G", 5000, 20000), ("S", 20000, None), ("G", 1000, 5000),
    ("S", 5000, 20000), ("G", 0, 1000), ("S", 1000, 5000), ("S", 0, 1000),
]
TIER_LABELS = {
    "G": "catégories générales", "S": "autres catégories",
}
CHAIN_MIN = 5  # un même site web sur 5 fiches ou plus = chaîne / grande enseigne : exclue
PLACE_COLS = ["nom", "categorie", "note", "nb_avis", "adresse", "telephone", "site_web", "lien_maps", "recherche"]

SCHEMA = """
create table if not exists places (
    place_id text primary key, nom text, categorie text, note real, nb_avis integer, adresse text,
    telephone text, site_web text, lien_maps text, recherche text, scanned_at text, exported integer default 0
);
create table if not exists seen (place_id text primary key);
create table if not exists cat_stats (
    categorie text primary key, searches integer default 0, kept integer default 0, new integer default 0,
    ema_kept real, ema_new real
);
create table if not exists cursors (tier integer, categorie text, zone_idx integer default 0, primary key (tier, categorie));
create table if not exists searches (
    id integer primary key, ts text, query text, tier integer, cards integer, new integer, kept integer, secs real, error text
);
create table if not exists state (key text primary key, value text);
create table if not exists site_places (site_key text, place_id text, primary key (site_key, place_id));
create table if not exists retry (
    tier integer, categorie text, zone_idx integer, attempts integer default 0, primary key (tier, categorie, zone_idx)
);
"""


# ---------------------------------------------------------------- Base de données (partagée avec le dashboard)
def connect() -> sqlite3.Connection:
    DATA.mkdir(exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    # Plusieurs onglets peuvent ouvrir la base au même instant : on réessaie l'initialisation.
    for attempt in range(20):
        try:
            db.execute("pragma journal_mode=wal")
            db.executescript(SCHEMA)
            cols = [r[1] for r in db.execute("pragma table_info(places)")]
            if "site_key" not in cols:
                db.execute("alter table places add column site_key text")
            for col in ("chain", "chain_marked"):  # chaîne repérée après coup (même site sur CHAIN_MIN fiches)
                if col not in cols:
                    db.execute(f"alter table places add column {col} integer default 0")
            # Une seule fiche par site web (cf. sites.py).
            db.execute("create unique index if not exists places_site on places (site_key) where site_key is not null")
            return db
        except sqlite3.OperationalError as e:
            if "locked" not in str(e) or attempt == 19:
                raise
            time.sleep(random.uniform(0.2, 1.0))
    return db


def get_state(db, key: str, default=None):
    row = db.execute("select value from state where key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def set_state(db, **kw):
    for k, v in kw.items():
        db.execute("insert or replace into state values (?, ?)", (k, json.dumps(v)))


def get_config(db) -> dict:
    return DEFAULT_CONFIG | (get_state(db, "config") or {})


def extra_exclusions(cfg: dict) -> tuple[str, ...]:
    return tuple(w.strip() for w in cfg.get("extra_exclusions", "").replace("\n", ",").split(",") if w.strip())


def make_exclude(cfg: dict):
    if not cfg.get("exclude_public_banks", True) and not extra_exclusions(cfg):
        return None
    from exclusions import exclusion_reason

    extra = extra_exclusions(cfg)
    if not cfg.get("exclude_public_banks", True):
        # Seulement les mots-clés supplémentaires.
        import re
        from categories import normalize

        rx = re.compile("|".join(r"\b" + re.escape(normalize(w)) + r"\b" for w in extra))
        return lambda nom, cat, site: "mot-clé" if rx.search(normalize(f"{nom} {cat}")) else None
    return lambda nom, cat, site: exclusion_reason(nom, cat, site, extra)


def is_chain_site(db, url: str) -> bool:
    from sites import site_key

    key = site_key(url)
    return bool(key and db.execute("select count(*) from site_places where site_key=?", (key,)).fetchone()[0] >= CHAIN_MIN)


def workers_state(db) -> list[dict]:
    """État des onglets (processus) encore vivants."""
    out = []
    for key, value in db.execute("select key, value from state where key like 'w%'").fetchall():
        w = json.loads(value) or {}
        if not w.get("pid"):
            continue
        try:
            os.kill(w["pid"], 0)
        except OSError:
            continue
        if time.time() - (w.get("heartbeat") or 0) < 600:
            out.append({"id": int(key[1:]), **w})
    return sorted(out, key=lambda w: w["id"])


def is_running(db) -> bool:
    return bool(workers_state(db))


def launch_detached(args: list[str], log: Path):
    """Lance un processus totalement détaché du dashboard (rattaché au système via nohup + &) :
    arrêter ou redémarrer le dashboard ne l'arrête pas. caffeinate empêche la mise en veille du Mac."""
    import shlex
    import subprocess

    cmd = " ".join(shlex.quote(a) for a in ["caffeinate", "-is", *args])
    subprocess.Popen(["/bin/sh", "-c", f"nohup {cmd} >> {shlex.quote(str(log))} 2>&1 &"], cwd=ROOT,
                     start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).wait()


def tier_label(i: int) -> str:
    kind, lo, hi = TIERS[i]
    n = lambda x: f"{x:,}".replace(",", " ")  # noqa: E731
    pop = f"villes de plus de {n(lo)} hab." if hi is None else f"villes de {n(lo)} à {n(hi)} hab."
    return f"Vague {i + 1}/{len(TIERS)} : {TIER_LABELS[kind]}, {pop}"


# ---------------------------------------------------------------- Zones et catégories
def load_zones() -> list[dict]:
    """Une zone par ville US (« Austin, TX »), des plus peuplées aux moins peuplées.

    data/zones.json : villes et localités du recensement US (Census Bureau, estimations 2023) + les 5 arrondissements de New York.
    """
    return json.loads(ZONES_PATH.read_text())


def load_categories(exclude: bool = True, extra: tuple[str, ...] = ()) -> tuple[list[str], list[str]]:
    from categories import labels, normalize

    generic = [l.strip() for l in (DATA / "generic.txt").read_text(encoding="utf-8").splitlines()
               if l.strip() and not l.startswith("#")]
    generic = list(dict.fromkeys(generic))
    gset = {normalize(g) for g in generic}
    others = [l for l in labels() if normalize(l) not in gset]
    if exclude:
        # Pas de recherches sur les catégories exclues (banques, administrations…) : temps gagné.
        from exclusions import excluded_category

        generic = [c for c in generic if not excluded_category(c, extra)]
        others = [c for c in others if not excluded_category(c, extra)]
    return generic, others


def tier_zones(zones: list[dict], i: int) -> list[dict]:
    _, lo, hi = TIERS[i]
    return [z for z in zones if z["pop"] >= lo and (hi is None or z["pop"] < hi)]


# ---------------------------------------------------------------- Google Sheets
def sync_sheets(db, log: logging.Logger) -> str:
    try:
        settings = json.loads(SETTINGS.read_text())
    except Exception:
        settings = {}
    if "GMB_SCAN_DB" in os.environ:
        return "Base de test : pas d'envoi vers Sheets."
    creds, url = ROOT / settings.get("creds_path", "credentials.json"), settings.get("sheet_url")
    if not url or not Path(creds).exists():
        return "Sheets non configuré (credentials.json manquant) : les fiches restent dans la base locale."
    rows = db.execute(f"select place_id, {', '.join(PLACE_COLS)}, scanned_at from places where exported=0 and chain=0 "
                      "order by scanned_at limit 5000").fetchall()
    chains = db.execute("select place_id, lien_maps from places where exported=1 and chain=1 and chain_marked=0").fetchall()
    if not rows and not chains:
        return f"Sheets à jour ({datetime.now():%H:%M})"
    import gspread

    gc = gspread.service_account(filename=creds)
    sh = gc.open_by_url(url)
    try:
        ws = sh.worksheet(SHEET_TAB)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(SHEET_TAB, rows=1000, cols=len(PLACE_COLS) + 1)
        ws.update([["Nom", "Catégorie", "Note", "Nb avis", "Adresse", "Téléphone", "Site web",
                    "Lien Google Maps", "Recherche", "Date"]], "A1")
        ws.freeze(rows=1)
    if rows:
        values = [["" if v is None else v for v in r[1:]] for r in rows]
        ws.append_rows(values, value_input_option="RAW")
        db.executemany("update places set exported=1 where place_id=?", [(r[0],) for r in rows])
        log.info("Sheets : %d fiches envoyées", len(rows))
    if chains:  # chaîne repérée après l'export : « exclu (chaîne) » pour que le bot de contact ne l'écrive pas
        from contact_bot import ensure_columns
        from gspread.utils import rowcol_to_a1

        cols = ensure_columns(ws)
        row_of = {l: i + 1 for i, l in enumerate(ws.col_values(cols["liengooglemaps"]))}
        ups = [{"range": rowcol_to_a1(row_of[l], cols["statutcontact"]), "values": [["exclu (chaîne)"]]}
               for _, l in chains if l in row_of]
        if ups:
            ws.batch_update(ups, value_input_option="RAW")
        db.executemany("update places set chain_marked=1 where place_id=?", [(p,) for p, _ in chains])
        log.info("Sheets : %d chaînes marquées « exclu »", len(ups))
    return f"Sheets : {len(rows)} fiches envoyées à {datetime.now():%H:%M}"


# ---------------------------------------------------------------- Boucle principale
class Crawler:
    """Un onglet de scan. Plusieurs instances (processus) tournent en parallèle et se partagent la file."""

    def __init__(self, worker: int = 0):
        self.worker = worker
        self.key = f"w{worker}"
        self.db = connect()
        self.log = logging.getLogger(f"scan{worker}")
        self.log.setLevel(logging.INFO)
        h = logging.FileHandler(LOG_PATH, encoding="utf-8")
        h.setFormatter(logging.Formatter(f"%(asctime)s [onglet {worker + 1}] %(message)s", "%Y-%m-%d %H:%M:%S"))
        self.log.addHandler(h)
        self.scraper = None
        self.searches_since_restart = 0
        self.consecutive_errors = 0
        self.last_sync = 0.0
        self.me = {"pid": os.getpid(), "status": "démarrage…"}
        signal.signal(signal.SIGTERM, lambda *_: set_state(self.db, control="stop"))

    # -- helpers
    def beat(self, **kw):
        self.me.update(kw, heartbeat=time.time())
        set_state(self.db, **{self.key: self.me})

    def control(self) -> str:
        return get_state(self.db, "control", "run")

    def known(self, pid: str) -> bool:
        return bool(self.db.execute("select 1 from places where place_id=? union all select 1 from seen where place_id=?",
                                    (pid, pid)).fetchone())

    def site_known(self, url: str) -> bool:
        from sites import site_key

        key = site_key(url)
        return bool(key and self.db.execute("select 1 from places where site_key=?", (key,)).fetchone())

    def make_exclude(self, cfg: dict):
        base = make_exclude(cfg)
        return lambda nom, cat, site: (base and base(nom, cat, site)) or (
            "chaîne (même site sur plusieurs fiches)" if site and is_chain_site(self.db, site) else None)

    def count_site(self, place):
        """Compte les fiches par site web : à CHAIN_MIN fiches, le site est une chaîne (fiche déjà gardée → exclue)."""
        from sites import site_key

        key = site_key(place.site_web)
        if not key or not self.db.execute("insert or ignore into site_places values (?, ?)", (key, place.place_id)).rowcount:
            return
        if self.db.execute("select count(*) from site_places where site_key=?", (key,)).fetchone()[0] == CHAIN_MIN:
            self.db.execute("update places set chain=1 where site_key=?", (key,))
            self.log.info("Chaîne repérée : %s", key)

    def kept_total(self) -> int:
        return self.db.execute("select count(*) from places where chain=0").fetchone()[0]

    def sleep(self, seconds: float, status: str):
        end = time.time() + seconds
        while time.time() < end and self.control() == "run":
            self.beat(status=status)
            time.sleep(min(5, max(0, end - time.time())))

    def open_browser(self, cfg: dict):
        from scraper import GMapsScraper

        self.close_browser()
        self.scraper = GMapsScraper(headless=cfg["headless"], delay=cfg["delay"],
                                    stop_flag=lambda: self.control() != "run").__enter__()
        self.searches_since_restart = 0

    def close_browser(self):
        if self.scraper:
            try:
                self.scraper.__exit__(None, None, None)
            except Exception:
                pass
        self.scraper = None

    # -- file de recherches partagée entre onglets
    def claim_task(self, tiers_zones: list[list[dict]], cats: dict[str, list[str]]):
        """Réserve atomiquement la prochaine recherche (aucun autre onglet ne pourra la prendre)."""
        self.db.execute("begin immediate")
        try:
            row = self.db.execute("select tier, categorie, zone_idx, attempts from retry order by attempts limit 1").fetchone()
            if row:
                self.db.execute("delete from retry where tier=? and categorie=? and zone_idx=?", row[:3])
                self.db.execute("commit")
                return row[0], row[1], row[2], tiers_zones[row[0]][row[2]], row[3]

            tier = get_state(self.db, "tier", 0)
            while tier < len(TIERS):
                n = len(tiers_zones[tier])
                self.db.executemany("insert or ignore into cursors (tier, categorie) values (?, ?)",
                                    [(tier, c) for c in cats[TIERS[tier][0]]])
                # Catégories jamais essayées d'abord (exploration), puis les plus rentables (moyenne glissante).
                row = self.db.execute(
                    """select c.categorie, c.zone_idx from cursors c left join cat_stats s using (categorie)
                       where c.tier=? and c.zone_idx<?
                       order by (s.ema_kept is not null), s.ema_kept desc, s.ema_new desc, random() limit 1""",
                    (tier, n),
                ).fetchone()
                if row:
                    self.db.execute("update cursors set zone_idx=zone_idx+1 where tier=? and categorie=?", (tier, row[0]))
                    self.db.execute("commit")
                    return tier, row[0], row[1], tiers_zones[tier][row[1]], 0
                tier += 1
                set_state(self.db, tier=tier)
                self.log.info("Passage à la vague %d", tier + 1)
            self.db.execute("commit")
            return None
        except BaseException:
            self.db.execute("rollback")
            raise

    def give_back(self, task: tuple, failed: bool):
        """Remet une recherche non terminée dans la file (abandonnée après 3 échecs)."""
        tier, cat, zone_idx, _, attempts = task
        attempts += 1 if failed else 0
        if attempts >= 3:
            self.log.warning("Recherche abandonnée après 3 échecs : %s %s", cat, task[3]["q"])
            return
        self.db.execute("insert or replace into retry values (?, ?, ?, ?)", (tier, cat, zone_idx, attempts))

    # -- une recherche
    def run_search(self, tier: int, cat: str, zone_idx: int, zone: dict, cfg: dict) -> bool:
        """Renvoie False si la recherche a été interrompue (pause / arrêt)."""
        from scraper import Filters

        query = f"{cat} {zone['q']}"
        filters = Filters(rating_min=cfg["rating_min"], rating_max=cfg["rating_max"],
                          min_reviews=int(cfg["min_reviews"]), include_unrated=cfg["rating_min"] <= 0,
                          website=cfg["website"], card_prefilter=True, exclude=self.make_exclude(cfg),
                          site_seen=self.site_known)
        self.beat(status="en cours", current=query, tier_label=tier_label(tier))
        t0 = time.time()
        cards = new = kept = 0
        for kind, obj in self.scraper.search(query, filters, max_results=int(cfg["max_results"]), known=self.known):
            if kind == "info":
                continue
            cards += 1
            self.count_site(obj)
            if kind == "known":
                continue
            new += 1
            if kind == "place":
                from sites import site_key

                # « or ignore » : si l'autre onglet vient d'enregistrer le même site, la fiche est écartée.
                inserted = self.db.execute(
                    f"insert or ignore into places (place_id, {', '.join(PLACE_COLS)}, scanned_at, site_key) "
                    f"values (?, {', '.join('?' * len(PLACE_COLS))}, ?, ?)",
                    (obj.place_id, *[getattr(obj, c) for c in PLACE_COLS], datetime.now().isoformat(timespec="seconds"),
                     site_key(obj.site_web)),
                ).rowcount
                if inserted:
                    kept += 1
                    self.beat(last_place=obj.nom)
                else:
                    self.db.execute("insert or ignore into seen values (?)", (obj.place_id,))
            else:
                self.db.execute("insert or ignore into seen values (?)", (obj.place_id,))

        if self.control() != "run":
            return False
        secs = round(time.time() - t0, 1)
        self.db.execute("insert into searches (ts, query, tier, cards, new, kept, secs) values (?,?,?,?,?,?,?)",
                        (datetime.now().isoformat(timespec="seconds"), query, tier, cards, new, kept, secs))
        self.db.execute(
            """insert into cat_stats (categorie, searches, kept, new, ema_kept, ema_new) values (?, 1, ?, ?, ?, ?)
               on conflict(categorie) do update set searches=searches+1, kept=kept+excluded.kept, new=new+excluded.new,
               ema_kept=0.7*ema_kept+0.3*excluded.ema_kept, ema_new=0.7*ema_new+0.3*excluded.ema_new""",
            (cat, kept, new, kept, new),
        )
        self.log.info("%s | %d fiches, %d nouvelles, %d retenues (%ss)", query, cards, new, kept, secs)
        self.searches_since_restart += 1
        return True

    # -- boucle
    def run(self):
        self.beat(status="démarrage…")
        self.log.info("Démarrage (pid %d)", os.getpid())
        zones = load_zones()
        cfg0 = get_config(self.db)
        generic, others = load_categories(cfg0["exclude_public_banks"], extra_exclusions(cfg0))
        cats = {"G": generic, "S": others}
        # Retire de la file les catégories désormais exclues (ex. « Banque » ajoutée aux exclusions).
        allowed = set(generic) | set(others)
        stale = [c for (c,) in self.db.execute("select distinct categorie from cursors union select categorie from retry")
                 if c not in allowed]
        if stale:
            self.db.executemany("delete from cursors where categorie=?", [(c,) for c in stale])
            self.db.executemany("delete from retry where categorie=?", [(c,) for c in stale])
            self.log.info("%d catégories exclues retirées de la file : %s", len(stale), ", ".join(stale[:10]))
        tiers_zones = [tier_zones(zones, i) for i in range(len(TIERS))]
        # Décale le démarrage des onglets pour ne pas taper Google au même instant.
        time.sleep(self.worker * random.uniform(5, 10))

        try:
            while True:
                ctl = self.control()
                if ctl == "stop":
                    break
                if ctl == "pause":
                    self.close_browser()
                    self.beat(status="en pause", current=None)
                    time.sleep(5)
                    continue

                blocked_until = get_state(self.db, "blocked_until", 0) or 0
                if time.time() < blocked_until:
                    self.close_browser()
                    self.sleep(blocked_until - time.time(), status="bloqué par Google : pause automatique")
                    continue

                cfg = get_config(self.db)
                if self.worker == 0 and time.time() - self.last_sync > cfg["sheets_every_min"] * 60:
                    self.last_sync = time.time()
                    try:
                        set_state(self.db, sheets_status=sync_sheets(self.db, self.log))
                    except Exception as e:
                        set_state(self.db, sheets_status=f"Erreur Sheets : {e}")
                        self.log.warning("Erreur Sheets : %s", e)

                if cfg["stop_at_target"] and self.kept_total() >= cfg["target"]:
                    self.beat(status="objectif atteint", current=None)
                    break

                task = self.claim_task(tiers_zones, cats)
                if task is None:
                    self.beat(status="terminé : toutes les vagues sont faites", current=None)
                    break

                if (self.scraper is None or self.searches_since_restart >= 150
                        or self.scraper.headless != cfg["headless"]):  # interrupteur visible/invisible changé
                    self.open_browser(cfg)
                self.scraper.delay = cfg["delay"]

                try:
                    if not self.run_search(*task[:4], cfg):
                        self.give_back(task, failed=False)
                        continue
                    self.consecutive_errors = 0
                    if get_state(self.db, "backoff", 0):
                        set_state(self.db, backoff=0)
                except RuntimeError as e:  # captcha / blocage : pause pour tous les onglets
                    self.give_back(task, failed=False)
                    backoff = min(max((get_state(self.db, "backoff", 0) or 0) * 2, 30), 240)
                    if time.time() >= (get_state(self.db, "blocked_until", 0) or 0):
                        set_state(self.db, backoff=backoff, blocked_until=time.time() + backoff * 60,
                                  last_error=f"{datetime.now():%d/%m %H:%M} {e} Reprise dans {backoff} min.")
                        self.log.warning("Bloqué par Google, pause %d min", backoff)
                    self.close_browser()
                except Exception as e:
                    self.consecutive_errors += 1
                    self.give_back(task, failed=True)
                    set_state(self.db, last_error=f"{datetime.now():%d/%m %H:%M} onglet {self.worker + 1} : "
                                                  f"{type(e).__name__}: {e}")
                    self.log.exception("Erreur sur « %s %s »", task[1], task[3]["q"])
                    self.close_browser()
                    if self.consecutive_errors >= 3:
                        self.sleep(300, status="erreurs répétées : pause 5 min")
                        self.consecutive_errors = 0
                    continue

                self.sleep(random.uniform(1, 3) * cfg["delay"], status="en cours")
        finally:
            self.close_browser()
            if self.worker == 0:
                try:
                    set_state(self.db, sheets_status=sync_sheets(self.db, self.log))
                except Exception:
                    pass
            if self.me.get("status") in ("en cours", "en pause", "démarrage…") or self.control() == "stop":
                self.me["status"] = "arrêté"
            self.me.update(current=None, pid=None)
            set_state(self.db, **{self.key: self.me}, last_status=self.me["status"])
            self.log.info("Arrêté")


if __name__ == "__main__":
    worker = int(sys.argv[sys.argv.index("--worker") + 1]) if "--worker" in sys.argv else 0
    Crawler(worker).run()
