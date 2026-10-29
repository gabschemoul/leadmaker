"""Variables des messages (même règles que apps/web/lib/leadmaker/templates.ts)."""
from __future__ import annotations

import random
import re
from typing import Any

ALIASES = {
    "entreprise": "company", "ville": "city", "categorie": "category", "note": "rating", "nb_avis": "reviews",
    "site": "website", "prenom": "first_name", "nom": "last_name", "societe": "my_company", "email": "my_email",
    "telephone": "my_phone", "mon_site": "my_website",
}
TOKEN = re.compile(r"\{([a-z_]+)\}", re.I)


def parse_templates(raw: Any) -> tuple[list[dict], dict]:
    """(messages, variante courte) depuis la colonne jsonb (tableau du lot 0 ou objet)."""
    if isinstance(raw, list):
        messages, short = raw, {}
    elif isinstance(raw, dict):
        messages, short = raw.get("messages") or [], raw.get("short") or {}
    else:
        messages, short = [], {}
    out = []
    for i, m in enumerate(messages[:4]):
        if not isinstance(m, dict):
            continue
        body = str(m.get("body") or "")
        if body.strip():
            out.append({"name": str(m.get("name") or f"Message {i + 1}"), "subject": str(m.get("subject") or ""),
                        "body": body})
    short = {"subject": str(short.get("subject") or ""), "body": str(short.get("body") or "")}
    return out, short


def values(prospect: dict, sender: dict) -> dict[str, str]:
    rating = prospect.get("rating")
    reviews = prospect.get("review_count")
    return {
        "company": prospect.get("name") or "", "city": prospect.get("city") or "",
        "category": prospect.get("category") or "", "rating": f"{float(rating):.1f}" if rating is not None else "",
        "reviews": str(reviews) if reviews is not None else "", "website": prospect.get("website") or "",
        "first_name": sender.get("first_name") or "", "last_name": sender.get("last_name") or "",
        "my_company": sender.get("company") or "", "my_email": sender.get("email") or "",
        "my_phone": sender.get("phone") or "", "my_website": sender.get("website") or "",
    }


PROSPECT_VARS = {"company", "city", "category", "rating", "reviews", "website"}
EMPTY_MARK = "\x00"
SENTENCE = re.compile(r"[^.!?]*[.!?]+\s*|[^.!?]+$")


def render(text: str, prospect: dict, sender: dict) -> str:
    """Remplace les variables. Une info manquante sur l'entreprise (pas de note, pas d'avis…) retire la phrase
    qui la contient, pour ne jamais écrire « : /5 avec avis ». Même règle que templates.ts côté interface."""
    vals = values(prospect, sender)

    def sub(m: re.Match) -> str:
        key = ALIASES.get(m.group(1).lower(), m.group(1).lower())
        if key not in vals:
            return m.group(0)
        if vals[key] == "" and key in PROSPECT_VARS:
            return EMPTY_MARK
        return vals[key]

    out = TOKEN.sub(sub, text or "")
    if EMPTY_MARK not in out:
        return out
    lines = []
    for line in out.split("\n"):
        if EMPTY_MARK in line:
            parts = SENTENCE.findall(line) or [line]
            line = "".join(p for p in parts if EMPTY_MARK not in p).rstrip()
        lines.append(line)
    cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip("\n")
    return cleaned if cleaned.strip() else out.replace(EMPTY_MARK, "")


def pick_balanced(messages: list[dict], counts: dict[str, int]) -> dict | None:
    """Rotation équilibrée : le message le moins utilisé (tirage au sort entre ex æquo)."""
    if not messages:
        return None
    least = min(counts.get(m["name"], 0) for m in messages)
    return random.choice([m for m in messages if counts.get(m["name"], 0) == least])


def short_version(messages: list[dict], short: dict) -> dict | None:
    """Variante courte explicite, sinon le message le plus court."""
    if short.get("body", "").strip():
        return {"name": "Version courte", "subject": short.get("subject", ""), "body": short["body"]}
    return min(messages, key=lambda m: len(m["body"])) if messages else None
