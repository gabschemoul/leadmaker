"""Les 4 053 catégories Google Business Profile — version US : libellés anglais (champ « en »).

Source : liste officielle par GCID (github.com/lobstrio/google-business-categories).
"""
from __future__ import annotations

import json
import unicodedata
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).parent / "data" / "categories_fr.json"

FAMILLES = {
    "Food & Drink": "Restauration & alimentation",
    "Retail & Shops": "Commerces",
    "Health & Medical": "Santé",
    "Wholesale & Supply": "Commerce de gros & fournisseurs",
    "Education & Training": "Éducation & formation",
    "Arts, Culture & Entertainment": "Arts, culture & loisirs",
    "Sports, Fitness & Recreation": "Sport & activités",
    "Manufacturing & Industrial": "Industrie & fabrication",
    "Automotive": "Automobile",
    "Construction & Trades": "BTP & artisans",
    "Legal & Professional Services": "Services juridiques & professionnels",
    "Nonprofits, Associations & Community": "Associations",
    "Government & Public Services": "Administrations & services publics",
    "Transport & Logistics": "Transport & logistique",
    "Religious & Spiritual": "Religion",
    "Home & Garden Services": "Maison & jardin",
    "Financial & Insurance": "Finance & assurance",
    "Agriculture, Farming & Natural Resources": "Agriculture",
    "Real Estate & Property": "Immobilier",
    "Beauty & Personal Care": "Beauté & bien-être",
    "Veterinary, Pets & Animals": "Animaux",
    "Technology & Telecom": "Informatique & télécoms",
    "Travel, Hotels & Tourism": "Tourisme & hébergement",
    "Places & Landmarks": "Lieux & sites",
    "Utilities & Energy": "Énergie & services publics",
}


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


@lru_cache(maxsize=1)
def load() -> list[dict]:
    """[{gcid, fr, en, famille}] trié par libellé anglais."""
    rows = json.loads(DATA.read_text(encoding="utf-8"))
    for r in rows:
        r["famille"] = FAMILLES.get(r.get("bucket", ""), "Autres")
        r["_key"] = normalize(f"{r['fr']} {r['en']}")
    return sorted(rows, key=lambda r: normalize(r["en"]))


def familles() -> list[str]:
    return sorted({r["famille"] for r in load()})


def labels(famille: str | None = None) -> list[str]:
    seen, out = set(), []
    for r in load():
        if (famille is None or r["famille"] == famille) and r["en"] not in seen:
            seen.add(r["en"])
            out.append(r["en"])
    return out


def search(query: str, famille: str | None = None) -> list[str]:
    """Libellés dont le nom FR ou EN contient tous les mots de la requête (sans tenir compte des accents)."""
    words = normalize(query).split()
    if not words:
        return []
    seen, out = set(), []
    for r in load():
        if famille and r["famille"] != famille:
            continue
        if all(w in r["_key"] for w in words) and r["en"] not in seen:
            seen.add(r["en"])
            out.append(r["en"])
    return out
