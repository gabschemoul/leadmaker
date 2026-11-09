"""Tri IA d'une campagne (CDC parcours / tri / annuaire §4, étape 3 : mesurer avant de changer le prix).

Usage (depuis la racine du dépôt, base en ligne via workers/.env.cloud) :
    workers/.venv/bin/python -I workers/scripts/sort_campaign.py bilan "Agences digital"
    workers/.venv/bin/python -I workers/scripts/sort_campaign.py lancer "Agences digital" \\
        --cible "Agences de communication… pour qui le web n'est pas le cœur de métier" \\
        --offre "Studio Namma développe en marque blanche les sites Webflow des agences…" --echantillon 300

« lancer » fixe la cible en mots de la campagne (et l'offre de son dossier si donnée) puis met en file le tri des
entreprises pas encore triées pour cette cible : un échantillon fixe de N entreprises avec --echantillon, sinon
toutes. Ensuite, chaque nouvelle entreprise trouvée par la campagne est triée au fil de l'eau. Une nouvelle cible
fait tout retrier (les anciens avis sont ignorés). Rien d'autre ne change : prix, crédits, écrans.
« bilan » affiche la part de gardées / à vérifier / écartées, le coût IA et quelques exemples.
Le nom de campagne doit être unique (sinon donner son identifiant).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

HAIKU_IN, HAIKU_OUT = 0.10 / 1e6, 0.50 / 1e6  # $ par jeton (claude-haiku-5-5)


def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = Path(__file__).resolve().parents[1] / ".env.cloud"
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("DATABASE_URL introuvable dans workers/.env.cloud")


def find_campaign(conn: psycopg.Connection, name: str) -> dict:
    rows = conn.execute(
        "select id, name, status, sort_target, sort_version from public.lm_campaigns "
        "where id::text = %s or name = %s", (name, name)).fetchall()
    if len(rows) != 1:
        sys.exit(f"{len(rows)} campagne(s) nommée(s) « {name} » : donner l'identifiant exact.")
    return rows[0]


def report(conn: psycopg.Connection, c: dict) -> None:
    print(f"Campagne « {c['name']} » ({c['status']}) — cible v{c['sort_version']} : {c['sort_target'] or '(aucune)'}")
    s = conn.execute(
        """select count(*) as total,
                  count(*) filter (where sorted_version = %(v)s) as triees,
                  count(*) filter (where sorted_version = %(v)s and verdict = 'gardee') as gardees,
                  count(*) filter (where sorted_version = %(v)s and verdict = 'a_verifier') as a_verifier,
                  count(*) filter (where sorted_version = %(v)s and verdict = 'ecartee') as ecartees
             from public.lm_campaign_prospects where campaign_id = %(id)s""",
        {"v": c["sort_version"], "id": c["id"]}).fetchone()
    t = conn.execute(
        """select count(*) filter (where status in ('queued', 'running')) as en_file,
                  count(*) filter (where status = 'failed') as echecs,
                  coalesce(sum((result ->> 'tokens_in')::bigint), 0) as tin,
                  coalesce(sum((result ->> 'tokens_out')::bigint), 0) as tout,
                  count(*) filter (where (result ->> 'reused')::boolean) as repris
             from public.lm_tasks where kind = 'sort' and payload ->> 'campaign_id' = %s
              and (payload ->> 'version')::int = %s""", (str(c["id"]), c["sort_version"])).fetchone()
    triees = s["triees"] or 0
    pct = (lambda n: f"{100 * n / triees:.0f} %") if triees else (lambda n: "-")
    cost = int(t["tin"]) * HAIKU_IN + int(t["tout"]) * HAIKU_OUT
    print(f"  entreprises : {s['total']} ; triées : {triees} ; en file : {t['en_file']} ; échecs : {t['echecs']}")
    print(f"  gardées {s['gardees']} ({pct(s['gardees'])}) · à vérifier {s['a_verifier']} ({pct(s['a_verifier'])}) "
          f"· écartées {s['ecartees']} ({pct(s['ecartees'])})")
    per = f" ; {cost / triees * 1000:.2f} $ / 1000" if triees else ""
    print(f"  coût IA : {cost:.2f} ${per} ; textes de site repris de l'annuaire : {t['repris']}")
    for verdict in ("gardee", "a_verifier", "ecartee"):
        rows = conn.execute(
            """select p.name, cp.reason from public.lm_campaign_prospects cp join public.lm_prospects p on p.id = cp.prospect_id
                where cp.campaign_id = %s and cp.sorted_version = %s and cp.verdict = %s
                order by cp.sorted_at desc limit 5""", (c["id"], c["sort_version"], verdict)).fetchall()
        if rows:
            print(f"  exemples « {verdict} » :")
            for r in rows:
                print(f"    - {r['name'][:45]:45} {r['reason'] or ''}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["lancer", "bilan"])
    ap.add_argument("campagne")
    ap.add_argument("--cible")
    ap.add_argument("--offre")
    ap.add_argument("--echantillon", type=int)
    a = ap.parse_args()
    with psycopg.connect(database_url(), row_factory=dict_row, autocommit=True) as conn:
        c = find_campaign(conn, a.campagne)
        if a.action == "lancer":
            if not a.cible:
                sys.exit("--cible est obligatoire pour lancer le tri")
            n = conn.execute("select public.lm_start_sort(%s, %s, %s, %s) as n",
                             (c["id"], a.cible, a.offre, a.echantillon)).fetchone()["n"]
            print(f"{n} entreprise(s) mise(s) en file de tri.")
            c = find_campaign(conn, str(c["id"]))
        report(conn, c)


if __name__ == "__main__":
    main()
