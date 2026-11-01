"""Règle le nombre de recherches Google Maps qu'une même campagne peut faire en même temps.

Usage (depuis la racine du dépôt, base en ligne via workers/.env.cloud) :
    workers/.venv/bin/python -I workers/scripts/set_discovery_parallel.py 6

Au-delà du nombre de robots de recherche (6 aujourd'hui), le réglage ne sert à rien : ce sont
les robots qui limitent. Quand plusieurs campagnes tournent, elles se partagent les robots.
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg


def database_url() -> str:
    env = Path(__file__).resolve().parents[1] / ".env.cloud"
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("DATABASE_URL introuvable dans workers/.env.cloud")


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit() or not 1 <= int(sys.argv[1]) <= 50:
        sys.exit(__doc__)
    value = int(sys.argv[1])
    with psycopg.connect(database_url(), prepare_threshold=None) as conn:
        before = conn.execute("select tasks_per_campaign from public.lm_discovery_settings where id").fetchone()[0]
        conn.execute(
            "update public.lm_discovery_settings set tasks_per_campaign = %s, updated_at = now() where id", (value,)
        )
        conn.commit()
    print(f"Recherches en parallèle par campagne : {before} → {value}. Effet dans la minute, sans redémarrage.")


if __name__ == "__main__":
    main()
