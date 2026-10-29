"""Exécute une tâche de découverte : une recherche « catégorie in ville, pays » pour une campagne."""
from __future__ import annotations

import logging
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

        filters = Filters(
            rating_min=rating_min,
            rating_max=float(f.get("rating_max", 5)),
            min_reviews=int(f.get("min_reviews", 0)),
            include_unrated=rating_min <= 0,
            website=f.get("website", "with"),
            exclude=_exclude_fn(f),
            site_seen=site_seen,
        )

        started = time.monotonic()
        cards = new = kept = 0
        stopped = None
        for kind, obj in self._scraper().search(p["query"], p["country_code"], filters,
                                               max_results=int(settings["max_results"]), known=known):
            if kind == "info":
                continue
            cards += 1
            if kind == "known":
                continue
            new += 1
            if kind != "place":
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
        """Recherche abandonnée après plusieurs échecs : on libère sa place dans la campagne."""
        conn.execute("select public.lm_release_search(%s, %s)", (task.payload["campaign_id"], task.payload["gcid"]))


__all__ = ["DiscoveryRunner", "BlockedError"]
