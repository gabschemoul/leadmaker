"""Catégories Google Business Profile (4 053 libellés FR / EN, source : liste officielle par GCID)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"

FAMILIES_FR = {
    "Food & Drink": "Restauration & alimentation", "Retail & Shops": "Commerces", "Health & Medical": "Santé",
    "Wholesale & Supply": "Commerce de gros & fournisseurs", "Education & Training": "Éducation & formation",
    "Arts, Culture & Entertainment": "Arts, culture & loisirs", "Sports, Fitness & Recreation": "Sport & activités",
    "Manufacturing & Industrial": "Industrie & fabrication", "Automotive": "Automobile",
    "Construction & Trades": "BTP & artisans", "Legal & Professional Services": "Services juridiques & professionnels",
    "Nonprofits, Associations & Community": "Associations", "Government & Public Services": "Administrations & services publics",
    "Transport & Logistics": "Transport & logistique", "Religious & Spiritual": "Religion",
    "Home & Garden Services": "Maison & jardin", "Financial & Insurance": "Finance & assurance",
    "Agriculture, Farming & Natural Resources": "Agriculture", "Real Estate & Property": "Immobilier",
    "Beauty & Personal Care": "Beauté & bien-être", "Veterinary, Pets & Animals": "Animaux",
    "Technology & Telecom": "Informatique & télécoms", "Travel, Hotels & Tourism": "Tourisme & hébergement",
    "Places & Landmarks": "Lieux & sites", "Utilities & Energy": "Énergie & services publics",
}


@lru_cache(maxsize=1)
def load() -> list[dict]:
    """[{gcid, fr, en, bucket}]"""
    return json.loads((DATA / "categories.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def generic_labels() -> list[str]:
    lines = (DATA / "generic.txt").read_text(encoding="utf-8").splitlines()
    return list(dict.fromkeys(l.strip() for l in lines if l.strip() and not l.startswith("#")))
