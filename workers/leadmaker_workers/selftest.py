"""Contrôle de santé des robots, lancé AVANT chaque mise à jour des serveurs (deploy-robots.sh).

    python -m leadmaker_workers.selftest            # tout : base, recherche Google Maps par le proxy, sites
    python -m leadmaker_workers.selftest --sites    # serveur d'envoi : base + visite d'un site sans proxy

Code de sortie 0 = la nouvelle version marche, 1 = elle est cassée (la mise à jour est alors annulée).
Ne touche ni aux campagnes ni aux crédits : la base est seulement lue, la recherche n'enregistre rien.
"""
from __future__ import annotations

import os
import sys
import time

import psycopg
from playwright.sync_api import sync_playwright

from .discovery.scraper import USER_AGENT, GMapsScraper, Place, proxy_from_env

# Paris centre, activité très fournie : une version saine trouve toujours des dizaines de fiches.
MAPS_QUERY = ("Restaurant", "fr", (48.85341, 2.34880, 15))
MIN_CARDS = 5


def check_database() -> str:
    with psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None, connect_timeout=15) as conn:
        conn.execute("select 1 from public.lm_tasks limit 1").fetchall()
    return "base de données joignable"


def check_maps() -> str:
    if not os.environ.get("PROXY_URL", "").strip():
        raise RuntimeError("PROXY_URL vide : la recherche Google Maps n'a pas de proxy")
    query, country, center = MAPS_QUERY
    started = time.monotonic()
    with GMapsScraper(headless=True, delay=0.5) as scraper:
        cards = scraper.list_cards(query, country, max_results=20, center=center)
        if len(cards) < MIN_CARDS:
            raise RuntimeError(f"liste Google Maps : {len(cards)} fiche(s) lue(s), {MIN_CARDS} attendues au moins")
        # Ouverture de vraies fiches : c'est ce chemin que la panne du 1/11 avait cassé
        page = scraper._ctx.new_page()
        opened = 0
        try:
            for card in cards[:3]:
                place = Place(name="")
                scraper._scrape_detail(page, card.maps_url, place)
                if place.name and (place.category or place.address):
                    opened += 1
        finally:
            page.close()
        if opened == 0:
            raise RuntimeError("aucune fiche Google Maps n'a pu être ouverte")
    return f"Google Maps par le proxy : {len(cards)} fiches listées, {opened} ouvertes en {time.monotonic() - started:.0f} s"


# Sites de test très stables : un seul doit s'afficher (un site isolé peut couper une connexion).
TEST_SITES = (("https://www.wikipedia.org/", "Wikipedia"), ("https://example.com/", "Example Domain"),
              ("https://www.iana.org/", "IANA"))


def check_sites() -> str:
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, proxy=proxy_from_env("OUTREACH_PROXY_URL"))
        try:
            ctx = browser.new_context(user_agent=USER_AGENT)
            for url, marker in TEST_SITES:
                page = ctx.new_page()
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    if marker in page.content():
                        return f"visite d'un site ({url}) : OK"
                    errors.append(f"{url} : contenu inattendu")
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{url} : {str(exc).splitlines()[0][:120]}")
                finally:
                    page.close()
        finally:
            browser.close()
    raise RuntimeError("aucun site de test ne s'affiche — " + " ; ".join(errors))


def main() -> None:
    checks = [check_database, check_sites] if "--sites" in sys.argv else [check_database, check_maps, check_sites]
    failed = False
    for check in checks:
        try:
            print(f"  ✓ {check()}", flush=True)
        except Exception as exc:  # noqa: BLE001 - on veut tout attraper et l'afficher
            failed = True
            print(f"  ✗ {check.__name__} : {type(exc).__name__}: {str(exc).splitlines()[0][:300]}", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
