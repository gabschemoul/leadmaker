"""Relance les recherches Google Maps qui ont échoué (panne de proxy, robots cassés…).

Usage (depuis la racine du dépôt, base en ligne via workers/.env.cloud) :
    workers/.venv/bin/python -I workers/scripts/retry_failed_searches.py          # dernières 6 heures
    workers/.venv/bin/python -I workers/scripts/retry_failed_searches.py 24       # dernières 24 heures

Seules les campagnes en cours sont concernées. Chaque recherche échouée repart avec
ses 3 essais : le quartier n'est plus sauté. Rien d'autre ne bouge (prospects, crédits).
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
    hours = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    with psycopg.connect(database_url(), prepare_threshold=None) as conn:
        rows = conn.execute(
            """with retried as (
                 update public.lm_tasks t
                    set status = 'queued', attempts = 0, error = null, finished_at = null,
                        worker_id = null, locked_at = null, run_after = now()
                   from public.lm_campaigns c
                  where t.kind = 'discovery' and t.status = 'failed'
                    and t.finished_at > now() - make_interval(hours => %s)
                    and c.id = (t.payload ->> 'campaign_id')::uuid
                    and c.status = 'running'
                 returning c.id as campaign_id, c.name, t.payload ->> 'gcid' as gcid
               ), per_category as (
                 update public.lm_campaign_categories cc
                    set in_flight = cc.in_flight + r.n
                   from (select campaign_id, gcid, count(*) as n from retried group by 1, 2) r
                  where cc.campaign_id = r.campaign_id and cc.gcid = r.gcid
                 returning 1
               )
               select name, count(*) from retried group by name order by 2 desc""",
            (hours,),
        ).fetchall()
        if not rows:
            print("Aucune recherche échouée à relancer.")
            return
        for name, n in rows:
            print(f"{name} : {n} recherches relancées")


if __name__ == "__main__":
    main()
