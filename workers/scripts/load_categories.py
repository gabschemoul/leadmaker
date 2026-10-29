"""Charge les 4 053 catégories Google dans public.lm_categories.

    DATABASE_URL=postgresql://... python scripts/load_categories.py

is_generic : catégories courantes scannées en premier (data/generic.txt).
is_excluded : administrations, services publics et banques (jamais recherchées).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402

from leadmaker_workers.discovery.categories import FAMILIES_FR, generic_labels, load  # noqa: E402
from leadmaker_workers.discovery.exclusions import excluded_category  # noqa: E402
from leadmaker_workers.discovery.text import normalize  # noqa: E402


def main() -> None:
    url = os.environ.get("DATABASE_URL") or sys.exit("DATABASE_URL manquant")
    generic = {normalize(l) for l in generic_labels()}
    rows = [
        (r["gcid"], r["en"], r["fr"], FAMILIES_FR.get(r.get("bucket", ""), "Autres"),
         normalize(r["en"]) in generic, excluded_category(r["en"]))
        for r in load()
    ]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.executemany(
            """insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded)
               values (%s, %s, %s, %s, %s, %s)
               on conflict (gcid) do update set label_en = excluded.label_en, label_fr = excluded.label_fr,
                 family = excluded.family, is_generic = excluded.is_generic, is_excluded = excluded.is_excluded""",
            rows,
        )
        conn.commit()
    print(f"{len(rows)} catégories, {sum(r[4] for r in rows)} générales, {sum(r[5] for r in rows)} exclues")


if __name__ == "__main__":
    main()
