"""Normalisation de texte et clé de dédoublonnage par site web (reprise de sites.py / categories.py)."""
from __future__ import annotations

import unicodedata
from urllib.parse import urlparse

# Plateformes partagées par des milliers d'établissements : le domaine ne suffit pas, on garde le lien complet.
PLATFORMS = {
    "doctolib.fr", "maiia.com", "keldoc.com", "facebook.com", "fb.com", "instagram.com", "linkedin.com",
    "tiktok.com", "twitter.com", "x.com", "youtube.com", "linktr.ee", "pagesjaunes.fr", "solocal.com",
    "site-solocal.com", "booking.com", "airbnb.fr", "airbnb.com", "tripadvisor.fr", "tripadvisor.com",
    "google.com", "google.fr", "business.site", "sites.google.com", "wixsite.com", "wix.com", "jimdo.com",
    "jimdofree.com", "webnode.fr", "e-monsite.com", "free.fr", "wordpress.com", "blogspot.com", "over-blog.com",
    "canalblog.com", "weebly.com", "godaddysites.com", "square.site", "ueniweb.com", "planity.com",
    "treatwell.fr", "thefork.fr", "lafourchette.com", "ubereats.com", "deliveroo.fr", "just-eat.fr",
    "order.store", "pappers.fr", "societe.com", "lacentrale.fr", "leboncoin.fr", "t.me", "wa.me",
    "calendly.com", "linkin.bio", "beacons.ai", "carrd.co", "notion.site", "yelp.fr", "yelp.com",
    "tiqets.com", "mappy.com", "justacote.com", "123devis.com", "habitatpresto.com", "starofservice.com",
    "doordash.com", "grubhub.com", "toasttab.com", "squareup.com", "clover.com", "vagaro.com",
    "schedulicity.com", "mindbodyonline.com", "booksy.com", "fresha.com", "setmore.com", "zocdoc.com",
}
SECOND_LEVEL = {"co", "com", "org", "net", "gouv", "asso", "ac", "edu", "gov"}


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _parse(url: str):
    return urlparse(url if "://" in url else f"http://{url}")


def domain(url: str) -> str:
    host = (_parse(url).hostname or "").lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in SECOND_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def site_key(url: str | None) -> str | None:
    """Domaine du site, ou lien complet (sans paramètres) pour les plateformes partagées."""
    if not url or not url.strip():
        return None
    url = url.strip()
    d = domain(url)
    if not d or "." not in d:
        return None
    p = _parse(url)
    host = (p.hostname or "").lower().removeprefix("www.")
    if d in PLATFORMS or host in PLATFORMS:
        return f"{host}{p.path.rstrip('/')}".lower()
    return d
