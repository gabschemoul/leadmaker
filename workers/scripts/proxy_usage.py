"""Consommation du proxy de recherche, mesurée par les robots (heure de Paris).

Usage (depuis la racine du dépôt) :
    workers/.venv/bin/python -I workers/scripts/proxy_usage.py

Affiche les 7 derniers jours, la consommation moyenne par recherche, et les campagnes du jour.
Chiffres = trafic réseau réel des robots (depuis le 2/11 ; avant : compteur du navigateur, 2 à 3 fois trop bas),\nmajorés de 5 % comme le plafond.
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

OVERHEAD = 1.05


def database_url() -> str:
    env = Path(__file__).resolve().parents[1] / ".env.cloud"
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("DATABASE_URL introuvable dans workers/.env.cloud")


def main() -> None:
    with psycopg.connect(database_url(), prepare_threshold=None) as conn:
        days = conn.execute(
            """select (updated_at at time zone 'Europe/Paris')::date as jour, count(*) as recherches,
                      sum((result ->> 'proxy_bytes')::bigint) as octets
                 from public.lm_tasks
                where kind in ('discovery', 'estimate') and result ? 'proxy_bytes'
                  and updated_at > now() - interval '7 days'
                group by 1 order by 1"""
        ).fetchall()
        campaigns = conn.execute(
            """select c.name, count(*) as recherches, sum((t.result ->> 'proxy_bytes')::bigint) as octets
                 from public.lm_tasks t join public.lm_campaigns c on c.id::text = t.payload ->> 'campaign_id'
                where t.kind = 'discovery' and t.result ? 'proxy_bytes'
                  and t.updated_at >= (date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')
                group by 1 order by 3 desc"""
        ).fetchall()
    if not days:
        print("Aucune mesure pour l'instant (les robots mesurent depuis leur mise à jour).")
        return
    print("Jour         Recherches   Consommation   Par recherche")
    for day, n, b in days:
        b = float(b or 0) * OVERHEAD
        print(f"{day}   {n:>10}   {b / 1e9:>9.2f} Go   {b / max(n, 1) / 1e6:>9.1f} Mo")
    if campaigns:
        print("\nAujourd'hui, par campagne :")
        for name, n, b in campaigns:
            print(f"  {name[:40]:<40} {n:>5} recherches   {float(b or 0) * OVERHEAD / 1e6:>8.0f} Mo")


if __name__ == "__main__":
    main()
