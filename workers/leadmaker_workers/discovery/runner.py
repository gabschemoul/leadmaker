"""Exécute une tâche de découverte : une recherche « catégorie in ville, pays » pour une campagne."""
from __future__ import annotations

import logging
import math
import os
import re
import time
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from ..queue import Task
from .exclusions import exclusion_reason
from .scraper import BlockedError, Filters, GMapsScraper, Place
from .text import normalize, site_key

log = logging.getLogger("leadmaker.discovery")

RESTART_EVERY = 150  # nouveau navigateur toutes les 150 recherches (mémoire, empreinte)


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


def _category_fn(filters: dict[str, Any], label: str | None):
    """Garde seulement les entreprises dont l'activité principale est celle recherchée (réglage par défaut)."""
    if not label or not filters.get("main_category_only", True):
        return None
    wanted = normalize(label).strip()
    return lambda category: not category or normalize(category).strip() == wanted


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
        campaign = conn.execute(
            "select id, status, space_id, country_code, filters from public.lm_campaigns where id = %s",
            (p["campaign_id"],),
        ).fetchone()
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

        started = time.monotonic()
        cards = new = kept = 0
        stopped = None
        center = None
        if p.get("latitude") is not None and p.get("longitude") is not None:
            center = (float(p["latitude"]), float(p["longitude"]), int(p.get("zoom") or 15))
        for kind, obj in self._scraper().search(p["query"], p["country_code"], filters,
                                               max_results=int(settings["max_results"]), known=known,
                                               center=center):
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
            key = site_key(obj.website)
            if not key:
                continue
            outcome = conn.execute(
                "select public.lm_record_prospect(%s, %s) as r",
                (p["campaign_id"], Jsonb({
                    "place_id": obj.place_id, "name": obj.name, "category": obj.category, "rating": obj.rating,
                    "review_count": obj.review_count, "address": obj.address, "phone": obj.phone,
                    "website": obj.website, "site_key": key, "maps_url": obj.maps_url,
                })),
            ).fetchone()["r"]
            if outcome == "kept":
                kept += 1
            elif outcome == "no_credits":
                stopped = "no_credits"
                break

        duration_ms = int((time.monotonic() - started) * 1000)
        conn.execute(
            "select public.lm_finish_search(%s, %s, %s, %s, %s, %s, %s, %s)",
            (p["campaign_id"], p["gcid"], p["zone_idx"], cards, new, kept, duration_ms, stopped),
        )
        log.info("%s | %d fiches, %d nouvelles, %d retenues (%.1fs)", p["query"], cards, new, kept, duration_ms / 1000)
        return {"cards": cards, "new": new, "kept": kept, "stopped": stopped}

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
        cards = self._scraper().list_cards(p["query"], p["country_code"], center=center)
        matching = []
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
            if website == "with" and not c.website or website == "without" and c.website:
                continue
            if min_reviews and c.review_count is not None and c.review_count < min_reviews:
                continue
            if exclude and exclude(c.name, "", c.website):
                continue
            matching.append(c.place_id)
        conn.execute("select public.lm_record_estimate_search(%s, %s, %s, %s)",
                     (p["estimate_id"], len(cards), matching, bool(p.get("is_grid"))))
        log.info("estimation | %s | %d fiches, %d correspondent", p["query"], len(cards), len(matching))
        return {"cards": len(cards), "matching": len(matching)}


__all__ = ["DiscoveryRunner", "BlockedError"]
