"""Lecture des fiches Google Maps avec Playwright (repris de scraper.py du prototype).

Interface Google Maps toujours en anglais (hl=en) pour que les sélecteurs et libellés restent stables
quel que soit le pays ciblé ; gl=<pays> oriente les résultats sur le pays de la campagne.
"""
from __future__ import annotations

import os
import random
import re
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator
from urllib.parse import quote_plus, urlparse

from playwright.sync_api import Page, TimeoutError as PWTimeout, sync_playwright

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
END_OF_LIST = re.compile(r"reached the end of the list|arrivé à la fin de la liste", re.I)
PLACE_ID = re.compile(r"!1s(0x[0-9a-f]+:0x[0-9a-f]+)")
COORDS = re.compile(r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)")
STATUS = re.compile(r"^(open|closed|opens|closes|temporarily|permanently|\d)", re.I)


def card_category(text: str) -> str:
    """Activité d'une carte de résultat : première partie d'une ligne « Activité · adresse »."""
    for line in (text or "").split("\n"):
        if "·" not in line:
            continue
        first = line.split("·")[0].strip()
        if first and not STATUS.match(first) and not first.startswith(("$", "€", "£")):
            return first
    return ""


PHONE = re.compile(r"(\+?\(?\d[\d\s().-]{6,}\d)")


def card_details(text: str) -> tuple[str, str]:
    """Adresse (partie après « Activité · ») et téléphone lus sur une carte de résultat."""
    address = phone = ""
    for line in (text or "").split("\n"):
        if "·" not in line:
            continue
        # Google glisse des icônes (caractères privés) à la place de l'adresse des entreprises sans local
        parts = [re.sub(r"[\ue000-\uf8ff]", "", x).strip() for x in line.split("·")]
        first = parts[0]
        if not address and first and not STATUS.match(first) and len(parts) > 1 and re.search(r"\w", parts[1]):
            address = parts[1]
        for part in parts[1:]:
            m = PHONE.fullmatch(part)
            if not phone and m and sum(ch.isdigit() for ch in part) >= 8:
                phone = part
    return address, phone


def coords(href: str) -> tuple[float | None, float | None]:
    m = COORDS.search(href or "")
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)


class BlockedError(RuntimeError):
    """Google a affiché une page de vérification (captcha) : il faut ralentir ou changer d'adresse."""


@dataclass
class Filters:
    rating_min: float = 0.0
    rating_max: float = 5.0
    min_reviews: int = 0
    include_unrated: bool = False
    website: str = "with"  # "all" | "with" | "without"
    # exclude(nom, categorie, site) -> raison ou None
    exclude: Callable[[str, str, str], str | None] | None = None
    # site_seen(url) -> vrai si un prospect avec ce site existe déjà (un seul prospect par site)
    site_seen: Callable[[str], bool] | None = None
    # in_area(place) -> vrai si l'entreprise est dans la zone ciblée (coordonnées du lien Google)
    in_area: Callable[["Place"], bool] | None = None
    # category_ok(activité) -> vrai si l'activité principale affichée est celle recherchée
    category_ok: Callable[[str], bool] | None = None


@dataclass
class Place:
    name: str
    category: str = ""
    rating: float | None = None
    review_count: int | None = None
    address: str = ""
    phone: str = ""
    website: str = ""
    maps_url: str = ""
    place_id: str = field(default="")
    latitude: float | None = None
    longitude: float | None = None
    card_category: str = ""  # activité affichée sur la carte de résultat (anglais)


def _parse_float(txt: str | None) -> float | None:
    if not txt:
        return None
    m = re.search(r"(\d+[.,]\d+|\d+)", txt)
    return float(m.group(1).replace(",", ".")) if m else None


def _parse_count(txt: str | None) -> int | None:
    if not txt:
        return None
    m = re.search(r"\(([\d\s  .,]+)\)", txt)
    if not m:
        return None
    digits = re.sub(r"\D", "", m.group(1))
    return int(digits) if digits else None


def _rating_ok(rating: float | None, f: Filters) -> bool:
    if rating is None:
        return f.include_unrated
    return f.rating_min <= rating <= f.rating_max


def _website_ok(site: str, f: Filters) -> bool:
    if f.website == "with":
        return bool(site)
    if f.website == "without":
        return not site
    return True


def _proxy_settings() -> dict | None:
    """PROXY_URL=http://user:pass@host:port (fournisseur de proxies résidentiels), facultatif."""
    url = os.environ.get("PROXY_URL", "").strip()
    if not url:
        return None
    p = urlparse(url)
    proxy = {"server": f"{p.scheme}://{p.hostname}:{p.port}"}
    if p.username:
        proxy.update(username=p.username, password=p.password or "")
    return proxy


class GMapsScraper:
    def __init__(self, headless: bool = True, delay: float = 1.5, stop_flag: Callable[[], bool] | None = None):
        self.headless = headless
        self.delay = delay
        self.stop_flag = stop_flag or (lambda: False)
        self._pw = self._browser = self._ctx = None
        self.searches = 0

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        self.close()

    def open(self):
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=self.headless, proxy=_proxy_settings())
        self._ctx = self._browser.new_context(
            user_agent=USER_AGENT, locale="en-US", viewport={"width": 1300, "height": 900}
        )
        # Images, vidéos et polices ne servent pas à la lecture des fiches : on ne les télécharge pas
        # (moins de bande passante, donc moins de coût de proxy).
        self._ctx.route(
            "**/*",
            lambda route: route.abort()
            if route.request.resource_type in ("image", "media", "font")
            else route.continue_(),
        )
        self.searches = 0

    def close(self):
        for obj in (self._ctx, self._browser):
            try:
                if obj:
                    obj.close()
            except Exception:
                pass
        if self._pw:
            try:
                self._pw.stop()
            except Exception:
                pass
        self._pw = self._browser = self._ctx = None

    @property
    def is_open(self) -> bool:
        return self._ctx is not None

    def _sleep(self, factor: float = 1.0):
        time.sleep(self.delay * factor * random.uniform(0.7, 1.3))

    @staticmethod
    def _accept_consent(page: Page):
        if "consent." not in page.url:
            return
        btn = page.get_by_role("button", name=re.compile(r"Reject all|Tout refuser|Accept all|Tout accepter", re.I))
        btn.first.click()
        page.wait_for_load_state("domcontentloaded")

    def _collect_cards(self, page: Page, max_results: int) -> list[dict]:
        feed = page.locator('div[role="feed"]')
        stale = 0
        last = 0
        while not self.stop_flag():
            count = feed.locator('a[href*="/maps/place/"]').count()
            if count >= max_results or END_OF_LIST.search(feed.inner_text()):
                break
            stale = stale + 1 if count == last else 0
            if stale >= 8:
                break
            last = count
            feed.evaluate("el => el.scrollBy(0, el.scrollHeight)")
            self._sleep(0.8)

        return feed.evaluate(
            """el => [...el.querySelectorAll('a[href*="/maps/place/"]')].map(a => {
                const card = a.parentElement;
                const star = card.querySelector('span[role="img"][aria-label*="star"], span[role="img"][aria-label*="toile"]');
                const site = card.querySelector('a[data-value="Website"], a[data-value="Site Web"]');
                return {
                    name: a.getAttribute('aria-label') || '',
                    href: a.href,
                    star: star ? star.getAttribute('aria-label') : null,
                    star_text: star && star.parentElement ? star.parentElement.innerText : '',
                    site: site ? site.href : '',
                    text: card.innerText || '',
                };
            })"""
        )[:max_results]

    def _scrape_detail(self, page: Page, url: str, place: Place):
        page.goto(url, wait_until="domcontentloaded")
        try:
            page.wait_for_selector("h1", timeout=15000)
        except PWTimeout:
            return
        page.wait_for_timeout(800)
        data = page.evaluate(
            """() => {
                const q = s => document.querySelector(s);
                const lbl = s => { const e = q(s); return e ? (e.getAttribute('aria-label') || '') : ''; };
                const rating = q('div.F7nice');
                const site = q('a[data-item-id="authority"]');
                const cat = q('button.DkEaL');
                return {
                    name: (q('h1.DUwDvf') || q('h1') || {}).innerText || '',
                    rating_text: rating ? rating.parentElement.innerText : '',
                    category: cat ? cat.innerText : '',
                    address: lbl('button[data-item-id="address"]'),
                    phone: lbl('button[data-item-id^="phone:tel:"]'),
                    site: site ? site.href : '',
                };
            }"""
        )
        place.name = data["name"].strip() or place.name
        place.category = data["category"].strip()
        place.address = re.sub(r"^\s*(Address|Adresse)\s*:\s*", "", data["address"]).strip()
        place.phone = re.sub(r"^.*?:\s*", "", data["phone"]).strip()
        place.website = data["site"] or place.website
        if data["rating_text"]:
            place.rating = _parse_float(data["rating_text"].split("\n")[0]) or place.rating
            place.review_count = _parse_count(data["rating_text"]) or place.review_count

    def search(self, query: str, country_code: str, filters: Filters, max_results: int = 120,
               known: Callable[[Place], bool] | None = None,
               center: tuple[float, float, int] | None = None) -> Iterator[tuple[str, Place | str]]:
        """Événements : ("info", str) | ("place", Place) | ("skip", Place) | ("known", Place).

        known(place) : vrai si la fiche a déjà été vue dans l'espace ; elle n'est alors pas rouverte.
        center : (latitude, longitude, zoom) pour chercher l'activité dans un secteur de la carte
        (grandes villes découpées en secteurs, Google n'affichant que 120 fiches par recherche).
        """
        if not self.is_open:
            self.open()
        self.searches += 1
        page = self._ctx.new_page()
        detail = self._ctx.new_page()
        try:
            at = f"/@{center[0]:.5f},{center[1]:.5f},{center[2]}z" if center else ""
            page.goto(f"https://www.google.com/maps/search/{quote_plus(query)}{at}?hl=en&gl={country_code.lower()}",
                      wait_until="domcontentloaded")
            self._accept_consent(page)
            if "/sorry/" in page.url:
                raise BlockedError("Google a bloqué la recherche (captcha)")

            try:
                page.wait_for_selector('div[role="feed"], h1.DUwDvf', timeout=20000)
            except PWTimeout:
                yield "info", f"aucun résultat pour « {query} »"
                return

            if page.locator('div[role="feed"]').count() == 0:
                # Un seul résultat : Google ouvre directement la fiche.
                cards = [{"name": "", "href": page.url, "star": None, "star_text": "", "site": "", "single": True}]
            else:
                cards = self._collect_cards(page, max_results)
            yield "info", f"« {query} » : {len(cards)} fiches"

            for c in cards:
                if self.stop_flag():
                    return
                rating = _parse_float(c["star"])
                place = Place(name=c["name"], rating=rating, review_count=_parse_count(c["star_text"]),
                              website=c["site"], maps_url=c["href"].split("?")[0],
                              card_category=card_category(c.get("text", "")))
                place.latitude, place.longitude = coords(c["href"])
                m = PLACE_ID.search(c["href"])
                place.place_id = m.group(1) if m else place.maps_url

                if filters.in_area and not filters.in_area(place):
                    yield "skip", place
                    continue
                if filters.category_ok and not filters.category_ok(place.card_category):
                    yield "skip", place
                    continue
                if known and known(place):
                    yield "known", place
                    continue
                if filters.exclude and filters.exclude(place.name, "", place.website):
                    yield "skip", place
                    continue
                if filters.site_seen and place.website and filters.site_seen(place.website):
                    yield "skip", place
                    continue

                # Pré-filtrage sur la liste, sans ouvrir la fiche (beaucoup plus rapide)
                if rating is not None and not _rating_ok(rating, filters):
                    yield "skip", place
                    continue
                # Sans bouton « Website » sur la carte, on ne sait pas encore : les restaurants, hôtels…
                # affichent « Réserver » ou « Commander » à la place. Il faut alors ouvrir la fiche.
                site_unknown = not c["site"] and filters.website != "all"
                if not c.get("single"):
                    if (rating is None and not filters.include_unrated) or (
                        not site_unknown and not _website_ok(c["site"], filters)
                    ):
                        yield "skip", place
                        continue
                    if filters.min_reviews and place.review_count is not None and place.review_count < filters.min_reviews:
                        yield "skip", place
                        continue

                # La carte suffit (activité, note, site, adresse, téléphone) : on n'ouvre la fiche que s'il manque
                # l'essentiel. Moins de pages demandées à Google : plus rapide, moins cher, moins de risque de blocage.
                if place.card_category and place.rating is not None and not c.get("single") and not site_unknown:
                    place.category = place.card_category
                    place.address, place.phone = card_details(c.get("text", ""))
                else:
                    self._scrape_detail(detail, c["href"], place)
                    if "/sorry/" in detail.url:
                        raise BlockedError("Google a bloqué la lecture d'une fiche (captcha)")
                    self._sleep()

                if not _rating_ok(place.rating, filters) or not _website_ok(place.website, filters):
                    yield "skip", place
                    continue
                if filters.exclude and filters.exclude(place.name, place.category, place.website):
                    yield "skip", place
                    continue
                if filters.site_seen and place.website and filters.site_seen(place.website):
                    yield "skip", place
                    continue
                if filters.min_reviews and (place.review_count or 0) < filters.min_reviews:
                    yield "skip", place
                    continue
                yield "place", place
        finally:
            page.close()
            detail.close()

    def list_cards(self, query: str, country_code: str, max_results: int = 120,
                   center: tuple[float, float, int] | None = None) -> list[Place]:
        """Lit seulement la liste des résultats (sans ouvrir les fiches) : nom, note, avis, présence d'un site."""
        if not self.is_open:
            self.open()
        self.searches += 1
        page = self._ctx.new_page()
        try:
            at = f"/@{center[0]:.5f},{center[1]:.5f},{center[2]}z" if center else ""
            page.goto(f"https://www.google.com/maps/search/{quote_plus(query)}{at}?hl=en&gl={country_code.lower()}",
                      wait_until="domcontentloaded")
            self._accept_consent(page)
            if "/sorry/" in page.url:
                raise BlockedError("Google a bloqué la recherche (captcha)")
            try:
                page.wait_for_selector('div[role="feed"], h1.DUwDvf', timeout=20000)
            except PWTimeout:
                return []
            if page.locator('div[role="feed"]').count() == 0:
                return []
            places = []
            for c in self._collect_cards(page, max_results):
                place = Place(name=c["name"], rating=_parse_float(c["star"]), review_count=_parse_count(c["star_text"]),
                              website=c["site"], maps_url=c["href"].split("?")[0],
                              card_category=card_category(c.get("text", "")))
                place.latitude, place.longitude = coords(c["href"])
                m = PLACE_ID.search(c["href"])
                place.place_id = m.group(1) if m else place.maps_url
                places.append(place)
            return places
        finally:
            page.close()
