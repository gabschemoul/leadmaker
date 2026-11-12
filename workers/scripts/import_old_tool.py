"""Importe dans l'annuaire commun les données de l'ancien outil (gmb-scraper, 28/10 → 1/11/2026, avant l'appli).

    workers/.venv/bin/python -I workers/scripts/import_old_tool.py DOSSIER [--pays US] [--ecrire]

DOSSIER contient scan.db (fiches retenues) et/ou contact.db (formulaires testés) de l'ancien outil. Sans --ecrire :
rien n'est écrit, le script compte seulement ce qui serait ajouté. Avec --ecrire :
- fiches → lm_places, seulement celles que l'annuaire n'a pas encore (une fiche déjà vue par l'appli n'est jamais
  remplacée par la donnée plus ancienne de l'outil) ;
- formulaires testés → lm_site_forms, source « old_tool », seulement pour les sites sans constat de l'appli. Ces
  constats sont gardés pour information : ils ne font jamais sauter la visite d'un site (lm_site_known_no_form).
Rien sur les envois de l'outil (« envoyé » est rangé comme « formulaire trouvé »). Base : workers/.env.cloud.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from leadmaker_workers.discovery.text import site_key  # noqa: E402

COUNTRIES = {"united states": "US", "usa": "US", "france": "FR", "belgium": "BE", "belgique": "BE",
             "canada": "CA", "united kingdom": "GB", "uk": "GB", "spain": "ES", "españa": "ES", "switzerland": "CH",
             "suisse": "CH", "germany": "DE", "deutschland": "DE", "italy": "IT", "italia": "IT", "mexico": "MX"}
FORM_STATUS = {"pas de formulaire": "no_form", "site inaccessible": "unreachable", "captcha": "protected",
               "envoyé": "form", "à envoyer": "form", "à valider": "form", "à vérifier": "form", "échec envoi": "form"}
COORDS = re.compile(r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)")
HTTP = re.compile(r"^https?://[^/\s]+", re.I)


def database_url() -> str:
    env = Path(__file__).resolve().parents[1] / ".env.cloud"
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("DATABASE_URL absent de workers/.env.cloud")


def country_of(address: str, default: str) -> str | None:
    if not (address or "").strip():
        return default
    last = address.rsplit(",", 1)[-1].strip().lower()
    return COUNTRIES.get(last)


def read_places(path: Path, default_country: str) -> tuple[list[tuple], int]:
    db = sqlite3.connect(f"file:{path}?immutable=1", uri=True)
    rows, skipped = [], 0
    for (pid, name, cat, rating, reviews, address, phone, site, maps, scanned, chain) in db.execute(
            "select place_id, nom, categorie, note, nb_avis, adresse, telephone, site_web, lien_maps, scanned_at, chain "
            "from places"):
        cc = country_of(address, default_country)
        name = (name or "").strip()[:500]
        if not pid or not name or not cc:
            skipped += 1
            continue
        site = site if site and HTTP.match(site) else None
        m = COORDS.search(maps or "")
        rows.append((pid, name, (cat or None) and cat[:255], address or None, cc,
                     float(m.group(1)) if m else None, float(m.group(2)) if m else None,
                     (phone or None) and phone[:50], site and site[:1000], site_key(site) if site else None,
                     bool(site), rating, reviews, (maps or None) and maps.split("?")[0][:1000], bool(chain),
                     scanned or None))
    return rows, skipped


def read_forms(path: Path) -> tuple[list[tuple], int]:
    db = sqlite3.connect(f"file:{path}?immutable=1", uri=True)
    best: dict[str, tuple] = {}
    skipped = 0
    for (key, site, status, form_url, at) in db.execute(
            "select site_key, site, status, form_url, coalesce(sent_at, prepared_at) from contacts"):
        st = FORM_STATUS.get((status or "").strip())
        k = site_key(site) if site else None
        k = k or (key or "").strip() or None
        if not st or not k or k.startswith(("maps:", "tel:")) or not at:
            skipped += 1
            continue
        url = form_url if st in ("form", "protected") and form_url and HTTP.match(form_url) else None
        if k not in best or at > best[k][3]:
            best[k] = (k, st, url and url[:2000], at)
    return list(best.values()), skipped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dossier", type=Path)
    ap.add_argument("--pays", default="US", help="pays des fiches sans adresse (défaut US)")
    ap.add_argument("--ecrire", action="store_true", help="écrire dans la base (sinon : comptage seulement)")
    ap.add_argument("--base", help="adresse d'une autre base (essai en local) ; défaut : workers/.env.cloud")
    a = ap.parse_args()

    places, p_skip = read_places(a.dossier / "scan.db", a.pays.upper()) if (a.dossier / "scan.db").exists() else ([], 0)
    forms, f_skip = read_forms(a.dossier / "contact.db") if (a.dossier / "contact.db").exists() else ([], 0)
    print(f"Lu : {len(places)} fiches ({p_skip} écartées), {len(forms)} sites avec formulaire testé ({f_skip} écartés)")

    with psycopg.connect(a.base or database_url(), row_factory=dict_row, prepare_threshold=None) as conn:
        conn.execute("create temp table imp_places (google_place_id text, name text, category text, address text, "
                     "country_code text, latitude float8, longitude float8, phone text, website text, site_key text, "
                     "website_known bool, rating numeric, review_count int, maps_url text, is_chain bool, seen_at text) "
                     "on commit drop")
        conn.execute("create temp table imp_forms (site_key text, status text, form_url text, checked_at text) on commit drop")
        with conn.cursor().copy("copy imp_places from stdin") as cp:
            for r in places:
                cp.write_row(r)
        with conn.cursor().copy("copy imp_forms from stdin") as cp:
            for r in forms:
                cp.write_row(r)

        new_places = conn.execute("select count(distinct google_place_id) as n from imp_places i where not exists "
                                  "(select 1 from public.lm_places p where p.google_place_id = i.google_place_id)").fetchone()["n"]
        new_forms = conn.execute("select count(*) as n from imp_forms i where not exists "
                                 "(select 1 from public.lm_site_forms f where f.site_key = i.site_key)").fetchone()["n"]
        by_status = conn.execute("select status, count(*) as n from imp_forms i where not exists (select 1 from "
                                 "public.lm_site_forms f where f.site_key = i.site_key) group by 1 order by 2 desc").fetchall()
        print(f"Nouveau pour l'annuaire : {new_places} fiches, {new_forms} sites avec formulaire testé "
              f"({', '.join(f'{r['status']} {r['n']}' for r in by_status)})")

        if not a.ecrire:
            print("Rien écrit (ajouter --ecrire pour importer).")
            conn.rollback()
            return

        n_places = conn.execute(
            """insert into public.lm_places as p (google_place_id, name, category, gcid, address, country_code, latitude,
                      longitude, phone, website, site_key, website_known, rating, review_count, maps_url, is_chain,
                      first_seen_at, last_seen_at, updated_at)
               select distinct on (i.google_place_id) i.google_place_id, i.name, i.category,
                      (select c.gcid from public.lm_categories c where c.label_en = i.category order by c.gcid limit 1),
                      i.address, i.country_code, i.latitude, i.longitude, i.phone, i.website, i.site_key, i.website_known,
                      round(i.rating, 1), i.review_count, i.maps_url, i.is_chain,
                      coalesce(i.seen_at::timestamptz, now()), coalesce(i.seen_at::timestamptz, now()), now()
                 from imp_places i
                order by i.google_place_id
               on conflict (google_place_id) do nothing""").rowcount
        n_forms = conn.execute(
            """insert into public.lm_site_forms (site_key, status, form_url, checked_at, source)
               select i.site_key, i.status, i.form_url, i.checked_at::timestamptz, 'old_tool' from imp_forms i
               on conflict (site_key) do nothing""").rowcount
        conn.commit()
        print(f"Écrit : {n_places} fiches dans l'annuaire, {n_forms} constats de formulaire (ancien outil).")


if __name__ == "__main__":
    main()
