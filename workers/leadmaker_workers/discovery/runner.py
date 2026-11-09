"""Exécute une tâche de découverte : une recherche « catégorie in ville, pays » pour une campagne."""
from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import time
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from .. import proxy_budget
from ..queue import Task
from .exclusions import exclusion_reason
from .scraper import BlockedError, Filters, GMapsScraper, Place
from .text import normalize, site_key

log = logging.getLogger("leadmaker.discovery")

RESTART_EVERY = 20  # nouveau navigateur toutes les 20 recherches : au-delà, la mémoire monte jusqu'au plantage (2/11/2026)
PAUSE_CHECK_SECONDS = 2.0  # le robot relit le statut de la campagne au plus toutes les 2 s pendant une recherche
# Estimation, listes compactes : une carte sans lien « Website » et sans aucun bouton a un site 149 fois sur 173
# (échantillon du 2/11/2026, 14 recherches FR/US). L'estimation n'ouvre pas les fiches : elle compte ces cartes
# à cette proportion, de façon déterministe par fiche (même décision à chaque passage, dédoublonnage intact).
COMPACT_SITE_RATE = 149 / 173


class CampaignPaused(RuntimeError):
    """La campagne a été mise en pause : le robot s'est arrêté entre deux fiches.

    Avant (2/11/2026), il finissait sa recherche et des prospects arrivaient encore pendant plusieurs minutes
    alors que l'écran disait « En pause ». La recherche interrompue est remise de côté (tâche annulée) et
    repart de zéro à la reprise ; les fiches déjà gardées sont reconnues (lm_mark_place_seen) et sautées."""


def _exclude_fn(filters: dict[str, Any]):
    extra = tuple(w.strip() for w in filters.get("extra_exclusions") or [] if str(w).strip())
    if filters.get("exclude_public", True):
        return lambda name, category, site: exclusion_reason(name, category, site, extra)
    if not extra:
        return None
    rx = re.compile("|".join(r"\b" + re.escape(normalize(w)) + r"\b" for w in extra))
    return lambda name, category, site: "mot-clé" if rx.search(normalize(f"{name} {category}")) else None


def _distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))


def _area_fn(conn: psycopg.Connection, geoname_id: int | None):
    """Garde seulement les entreprises situées dans la ville ciblée (rayon selon sa taille, + 1,5 km de marge)."""
    if not geoname_id:
        return None
    city = conn.execute(
        "select latitude, longitude, population from public.lm_geo_cities where geoname_id = %s", (geoname_id,)
    ).fetchone()
    if not city:
        return None
    max_km = min(12.0, max(1.5, math.sqrt(city["population"] or 0) / 150.0)) + 1.5

    def in_area(place: Place) -> bool:
        if place.latitude is None or place.longitude is None:
            return True
        return _distance_km(city["latitude"], city["longitude"], place.latitude, place.longitude) <= max_km

    return in_area


def _category_matches(category: str, wanted: str) -> bool:
    """L'activité de la fiche correspond-elle à l'activité recherchée ?

    Google donne souvent une activité plus précise que celle cherchée : « French restaurant » ou
    « Pizza restaurant » pour « Restaurant », « Emergency plumber » pour « Plumber ». On garde donc
    la fiche quand tous les mots de l'activité cherchée apparaissent, entiers, dans la sienne
    (pluriels tolérés). « Restaurant supply store » reste écarté pour « Restaurant » : c'est un
    magasin, son dernier mot n'est pas l'activité cherchée.
    """
    def words(text: str) -> list[str]:
        return [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", normalize(text))]

    have, need = words(category), words(wanted)
    if not need:
        return True
    if have == need:
        return True
    # tous les mots cherchés présents, et l'activité de la fiche se termine par le dernier mot cherché
    # (« French restaurant » ✓, « Restaurant supply store » ✗)
    return all(w in have for w in need) and have[-1:] == need[-1:]


def likely_has_site(place_id: str, rate: float = COMPACT_SITE_RATE) -> bool:
    """Tirage déterministe : vrai pour `rate` des fiches, toujours le même pour une fiche donnée."""
    digest = hashlib.sha1(place_id.encode("utf-8")).hexdigest()[:8]
    return int(digest, 16) / 0xFFFFFFFF < rate


def record_places(conn: psycopg.Connection, payload: dict[str, Any], scraper: GMapsScraper, in_area) -> int | None:
    """Range dans l'annuaire commun (lm_places) toutes les fiches vues par la recherche, écartées comprises, et
    note la recherche au registre (lm_place_searches). CDC-PARCOURS-TRI-ANNUAIRE §8.2, étape 1.

    Ne doit JAMAIS faire échouer une recherche : en cas d'erreur (fonction absente tant que la base n'est pas
    à jour, coupure…), un simple avertissement. La ville n'est notée que si l'entreprise est dans la zone."""
    try:
        return _record_places(conn, payload, scraper, in_area)
    except Exception as exc:
        log.warning("annuaire : fiches non rangées (%s)", str(exc).splitlines()[0] if str(exc) else type(exc).__name__)
        return None


def _record_places(conn: psycopg.Connection, payload: dict[str, Any], scraper: GMapsScraper, in_area) -> int | None:
    places = scraper.last_places
    if not places and not scraper.last_complete:
        return None
    city, geoname_id = payload.get("city"), payload.get("geoname_id")
    rows = []
    for pl in places:
        here = in_area(pl) if in_area else True
        rows.append({
            "place_id": pl.place_id, "name": pl.name, "category": pl.category or pl.card_category,
            "rating": pl.rating, "review_count": pl.review_count, "address": pl.address, "phone": pl.phone,
            "website": pl.website, "site_key": site_key(pl.website) or None, "website_known": pl.website_known,
            "maps_url": pl.maps_url, "latitude": pl.latitude, "longitude": pl.longitude,
            "city": city if here else None, "geoname_id": geoname_id if here else None, "opened": pl.opened,
        })
    search = {
        "country_code": payload.get("country_code"), "gcid": payload.get("gcid"), "geoname_id": geoname_id,
        "latitude": payload.get("latitude"), "longitude": payload.get("longitude"), "zoom": payload.get("zoom"),
        "query": payload.get("query"), "complete": scraper.last_complete, "source": "discovery",
        "campaign_id": payload.get("campaign_id"),
    }
    return conn.execute("select public.lm_record_search_places(%s, %s) as n",
                        (Jsonb(search), Jsonb(rows))).fetchone()["n"]


def _category_fn(filters: dict[str, Any], label: str | None):
    """Garde seulement les entreprises dont l'activité principale est celle recherchée (réglage par défaut)."""
    if not label or not filters.get("main_category_only", True):
        return None
    return lambda category: not category or _category_matches(category, label)


class DiscoveryRunner:
    def __init__(self):
        self.scraper: GMapsScraper | None = None

    def close(self):
        if self.scraper:
            self.scraper.close()
            self.scraper = None

    def _scraper(self) -> GMapsScraper:
        if self.scraper is None or self.scraper.searches >= RESTART_EVERY:
            self.close()
            self.scraper = GMapsScraper(
                headless=os.environ.get("HEADLESS", "true").lower() != "false",
                delay=float(os.environ.get("SCRAPE_DELAY", "1.5")),
            )
            self.scraper.open()
        return self.scraper

    def run(self, task: Task, conn: psycopg.Connection) -> dict[str, Any]:
        p = task.payload
        proxy_budget.check(conn)
        campaign = conn.execute(
            "select id, status, space_id, country_code, filters from public.lm_campaigns where id = %s",
            (p["campaign_id"],),
        ).fetchone()
        if campaign and campaign["status"] == "paused":
            # Mise en pause entre la planification et le début de la recherche : elle repartira à la reprise
            conn.execute("select public.lm_release_search(%s, %s)", (p["campaign_id"], p["gcid"]))
            raise CampaignPaused(f"campagne en pause : recherche « {p['query']} » reportée à la reprise")
        if not campaign or campaign["status"] != "running":
            conn.execute("select public.lm_release_search(%s, %s)", (p["campaign_id"], p["gcid"]))
            return {"skipped": "campagne inactive"}

        settings = conn.execute("select max_results from public.lm_discovery_settings where id").fetchone()
        f = campaign["filters"] or {}
        rating_min = float(f.get("rating_min", 0))
        space_id = str(campaign["space_id"])

        def known(place: Place) -> bool:
            # Marque la fiche comme vue ; si elle l'était déjà dans l'espace, on ne la rouvre pas.
            first_time = conn.execute(
                "select public.lm_mark_place_seen(%s, %s, %s) as first",
                (space_id, place.place_id, site_key(place.website)),
            ).fetchone()["first"]
            return not first_time

        def site_seen(url: str) -> bool:
            key = site_key(url)
            return bool(key) and conn.execute(
                "select public.lm_site_known(%s, %s) as k", (space_id, key)
            ).fetchone()["k"]

        geoname_id = p.get("geoname_id") or (conn.execute(
            "select geoname_id from public.lm_campaign_zones where campaign_id = %s and idx = %s",
            (p["campaign_id"], p["zone_idx"]),
        ).fetchone() or {}).get("geoname_id")
        category_ok = _category_fn(f, p.get("category"))
        filters = Filters(
            rating_min=rating_min,
            rating_max=float(f.get("rating_max", 5)),
            min_reviews=int(f.get("min_reviews", 0)),
            include_unrated=rating_min <= 0,
            website=f.get("website", "with"),
            exclude=_exclude_fn(f),
            site_seen=site_seen,
            in_area=_area_fn(conn, geoname_id),
            category_ok=category_ok,
        )

        # Pendant la recherche, le robot relit le statut de la campagne (au plus toutes les 2 s) : mise en
        # pause, il s'arrête entre deux fiches au lieu de finir le quartier (voir CampaignPaused).
        pause_state = {"checked": time.monotonic(), "paused": False}

        def paused() -> bool:
            if pause_state["paused"]:
                return True
            now = time.monotonic()
            if now - pause_state["checked"] < PAUSE_CHECK_SECONDS:
                return False
            pause_state["checked"] = now
            try:
                row = conn.execute("select status from public.lm_campaigns where id = %s", (p["campaign_id"],)).fetchone()
            except Exception:
                log.warning("statut de la campagne illisible, la recherche continue", exc_info=True)
                return False
            pause_state["paused"] = bool(row) and row["status"] == "paused"
            return pause_state["paused"]

        started = time.monotonic()
        cards = new = kept = 0
        stopped = None
        # Une seule référence au navigateur pour toute la recherche : self._scraper() peut le remplacer par un
        # neuf (RESTART_EVERY) et ses compteurs repartiraient de zéro en cours de route.
        scraper = self._scraper()
        bytes_before = scraper.bytes
        opened_before = scraper.opened
        center = None
        if p.get("latitude") is not None and p.get("longitude") is not None:
            center = (float(p["latitude"]), float(p["longitude"]), int(p.get("zoom") or 15))
        scraper.stop_flag = paused
        try:
            for kind, obj in scraper.search(p["query"], p["country_code"], filters,
                                            max_results=int(settings["max_results"]), known=known, center=center):
                if kind == "info":
                    continue
                cards += 1
                if kind == "known":
                    continue
                new += 1
                if kind != "place":
                    continue
                # La fiche ouverte confirme l'activité principale
                if category_ok and obj.category and not category_ok(obj.category):
                    continue
                # Sans site web : prospect gardé quand même (à appeler ou à exporter), identifié par sa fiche Google
                key = site_key(obj.website) or f"maps:{obj.place_id}"
                outcome = conn.execute(
                    "select public.lm_record_prospect(%s, %s) as r",
                    (p["campaign_id"], Jsonb({
                        "place_id": obj.place_id, "name": obj.name, "category": obj.category, "rating": obj.rating,
                        "review_count": obj.review_count, "address": obj.address, "phone": obj.phone,
                        "website": obj.website, "site_key": key, "maps_url": obj.maps_url,
                        "city": p.get("city"),
                    })),
                ).fetchone()["r"]
                if outcome == "kept":
                    kept += 1
                elif outcome == "no_credits":
                    stopped = "no_credits"
                    break
        finally:
            scraper.stop_flag = lambda: False
            # Même si la recherche s'arrête (pause, crédits épuisés, blocage) : tout ce qui a été vu est gardé
            stored = record_places(conn, p, scraper, filters.in_area)

        duration_ms = int((time.monotonic() - started) * 1000)
        proxy_bytes = scraper.bytes - bytes_before
        opened = scraper.opened - opened_before
        if pause_state["paused"]:
            # Arrêt entre deux fiches : la place est libérée, la tâche sera annulée (main.py) et repartira
            # à la reprise de la campagne. Les prospects déjà gardés le restent.
            conn.execute("select public.lm_release_search(%s, %s)", (p["campaign_id"], p["gcid"]))
            raise CampaignPaused(
                f"campagne mise en pause : recherche « {p['query']} » arrêtée après {cards} fiches "
                f"({kept} retenues, {duration_ms / 1000:.0f} s, {proxy_bytes / 1e6:.1f} Mo), reprise plus tard"
            )
        conn.execute(
            "select public.lm_finish_search(%s, %s, %s, %s, %s, %s, %s, %s)",
            (p["campaign_id"], p["gcid"], p["zone_idx"], cards, new, kept, duration_ms, stopped),
        )
        log.info("%s | %d fiches, %d nouvelles, %d retenues (%.1fs, %.1f Mo)", p["query"], cards, new, kept,
                 duration_ms / 1000, proxy_bytes / 1e6)
        return {"cards": cards, "new": new, "kept": kept, "opened": opened, "stopped": stopped,
                "proxy_bytes": proxy_bytes, "places_stored": stored}

    def on_final_failure(self, task: Task, conn: psycopg.Connection) -> None:
        """Recherche abandonnée après plusieurs échecs : on libère sa place (campagne) ou on la compte vide (estimation)."""
        if task.kind == "estimate":
            conn.execute("select public.lm_skip_estimate_search(%s)", (task.payload["estimate_id"],))
            return
        conn.execute("select public.lm_release_search(%s, %s)", (task.payload["campaign_id"], task.payload["gcid"]))

    def estimate(self, task: Task, conn: psycopg.Connection) -> dict[str, Any]:
        """Estimation réelle : lit la liste Google Maps et compte les fiches qui passent les filtres."""
        p = task.payload
        est = conn.execute("select status, filters from public.lm_estimates where id = %s", (p["estimate_id"],)).fetchone()
        if not est or est["status"] != "running":
            return {"skipped": "estimation terminée ou remplacée"}
        proxy_budget.check(conn)
        f = est["filters"] or {}
        rating_min = float(f.get("rating_min", 0))
        rating_max = float(f.get("rating_max", 5))
        min_reviews = int(f.get("min_reviews", 0))
        website = f.get("website", "all")
        exclude = _exclude_fn(f)
        in_area = _area_fn(conn, p.get("geoname_id"))
        category_ok = _category_fn(f, p.get("category"))
        center = None
        if p.get("latitude") is not None and p.get("longitude") is not None:
            center = (float(p["latitude"]), float(p["longitude"]), int(p.get("zoom") or 15))
        bytes_before = self._scraper().bytes
        cards = self._scraper().list_cards(p["query"], p["country_code"], center=center)
        proxy_bytes = self._scraper().bytes - bytes_before
        matching = []
        compact = 0  # cartes de liste compacte sans lien « Website » (site inconnu sans ouvrir la fiche)
        for c in cards:
            if in_area and not in_area(c):
                continue
            if category_ok and not category_ok(c.card_category):
                continue
            if c.rating is None:
                if rating_min > 0:
                    continue
            elif not rating_min <= c.rating <= rating_max:
                continue
            has_site = bool(c.website)
            if not has_site and c.site_unknown and website != "all":
                # Liste compacte : le site n'est pas visible sur la carte. Avant, ces cartes comptaient toutes
                # pour « sans site » et l'estimation des restaurants, hôtels, coiffeurs… était très en dessous.
                compact += 1
                has_site = likely_has_site(c.place_id)
            if website == "with" and not has_site or website == "without" and has_site:
                continue
            if min_reviews and c.review_count is not None and c.review_count < min_reviews:
                continue
            if exclude and exclude(c.name, "", c.website):
                continue
            matching.append(c.place_id)
        conn.execute("select public.lm_record_estimate_search(%s, %s, %s, %s)",
                     (p["estimate_id"], len(cards), matching, bool(p.get("is_grid"))))
        log.info("estimation | %s | %d fiches, %d correspondent (%d en liste compacte sans lien site)", p["query"],
                 len(cards), len(matching), compact)
        return {"cards": len(cards), "matching": len(matching), "compact": compact, "proxy_bytes": proxy_bytes}


__all__ = ["CampaignPaused", "DiscoveryRunner", "BlockedError"]
