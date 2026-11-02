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
# Trafic réseau réel maximal pour la liste + 3 fiches. Au-delà, une version gaspille le proxy (facturé au Mo).
MAX_MAPS_MB = 12  # mesuré le 2/11/2026 : ~7 Mo réels


def _network_rx() -> int | None:
    """Octets reçus par la carte réseau du conteneur : la VRAIE consommation, processus de fond compris
    (le compteur interne du navigateur n'en voit qu'une partie)."""
    try:
        with open("/sys/class/net/eth0/statistics/rx_bytes") as fh:
            return int(fh.read())
    except OSError:
        return None


def check_database() -> str:
    with psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None, connect_timeout=15) as conn:
        conn.execute("select 1 from public.lm_tasks limit 1").fetchall()
    return "base de données joignable"


def check_maps() -> str:
    if not os.environ.get("PROXY_URL", "").strip():
        raise RuntimeError("PROXY_URL vide : la recherche Google Maps n'a pas de proxy")
    query, country, center = MAPS_QUERY
    started, rx_before = time.monotonic(), _network_rx()
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
    rx_after = _network_rx()
    real = (rx_after - rx_before) / 1e6 if rx_before is not None and rx_after is not None else None
    if real is not None and real > MAX_MAPS_MB:
        raise RuntimeError(f"trafic réseau réel {real:.1f} Mo pour la recherche de test (maximum {MAX_MAPS_MB} Mo) : "
                           "cette version consommerait trop de proxy")
    shown = f"{real:.1f} Mo réels" if real is not None else "trafic réel non mesurable ici"
    return (f"Google Maps par le proxy : {len(cards)} fiches listées, {opened} ouvertes "
            f"en {time.monotonic() - started:.0f} s, {shown}")


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
        # Un deuxième essai : une page qui ne répond pas une fois (proxy tournant) ne doit pas bloquer une mise à jour
        for attempt in (1, 2):
            try:
                print(f"  ✓ {check()}", flush=True)
                break
            except Exception as exc:  # noqa: BLE001 - on veut tout attraper et l'afficher
                print(f"  {'✗' if attempt == 2 else '…'} {check.__name__} : {type(exc).__name__}: "
                      f"{str(exc).splitlines()[0][:300]}{'' if attempt == 2 else ' (nouvel essai)'}", flush=True)
                failed = failed or attempt == 2
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
