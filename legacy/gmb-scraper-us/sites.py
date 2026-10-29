"""Clé de dédoublonnage par site web : une seule fiche par site (ex. une seule station « Wash » pour
wash-totalenergies.fr, même si l'enseigne a des dizaines de points de vente).

Pour les plateformes partagées par des milliers d'établissements (Doctolib, Facebook, PagesJaunes…),
le domaine ne suffit pas : on compare alors le lien complet (sans les paramètres de suivi).
"""
from __future__ import annotations

from urllib.parse import urlparse

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
}
SECOND_LEVEL = {"co", "com", "org", "net", "gouv", "asso", "ac", "edu", "gov"}


def domain(url: str) -> str:
    host = (urlparse(url if "://" in url else f"http://{url}").hostname or "").lower().removeprefix("www.")
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
    if not d:
        return None
    host = (urlparse(url if "://" in url else f"http://{url}").hostname or "").lower().removeprefix("www.")
    if d in PLATFORMS or host in PLATFORMS:
        p = urlparse(url if "://" in url else f"http://{url}")
        return f"{host}{p.path.rstrip('/')}".lower()
    return d
