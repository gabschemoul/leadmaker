"""Plafond quotidien de consommation du proxy résidentiel (facturé au volume).

Chaque recherche Google Maps mesure son VRAI trafic réseau (octets reçus et envoyés par la carte réseau
du conteneur, processus de fond de Chromium compris, essais ratés compris) et l'enregistre dans le
résultat de sa tâche (`proxy_bytes`). Le compteur du navigateur n'en voyait qu'un tiers à la moitié
(mesuré le 2/11/2026) ; il ne sert plus que si la carte réseau n'est pas lisible (Mac en local). Avant chaque recherche, le robot additionne la consommation du
jour (heure de Paris) ; au-delà de PROXY_DAILY_BUDGET_GB (3 Go par défaut), il remet la recherche à
plus tard et se met en pause jusqu'au lendemain. Un forfait ne peut donc plus se vider en une soirée.

Le trafic réseau compte déjà l'envoi et le chiffrement ; on garde 5 % de marge (requêtes de la base
de données incluses dans la mesure, écarts de comptage du fournisseur).
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg

PARIS = ZoneInfo("Europe/Paris")
OVERHEAD = 1.05


class BudgetExceeded(RuntimeError):
    """Plafond quotidien de proxy atteint : la recherche attend le lendemain."""

    def __init__(self, used_gb: float, budget_gb: float, seconds_left: float):
        super().__init__(f"plafond proxy du jour atteint ({used_gb:.2f} Go sur {budget_gb:.2f} Go)")
        self.seconds_left = seconds_left


def network_bytes() -> int | None:
    """Octets reçus + envoyés par la carte réseau du conteneur depuis son démarrage (None hors conteneur)."""
    try:
        total = 0
        for name in ("rx_bytes", "tx_bytes"):
            with open(f"/sys/class/net/eth0/statistics/{name}") as fh:
                total += int(fh.read())
        return total
    except (OSError, ValueError):
        return None


def add_task_bytes(conn: psycopg.Connection, task_id: int, nbytes: int) -> None:
    """Ajoute des octets au compte d'une tâche (essai raté ou remis en file : il a consommé quand même)."""
    if nbytes <= 0:
        return
    conn.execute(
        """update public.lm_tasks
              set result = coalesce(result, '{}'::jsonb)
                           || jsonb_build_object('proxy_bytes', coalesce((result ->> 'proxy_bytes')::bigint, 0) + %s)
            where id = %s""",
        (nbytes, task_id),
    )


def add_search_bytes(conn: psycopg.Connection, task_id: int, nbytes: int) -> None:
    """Ajoute le trafic d'une recherche ou d'une estimation au compteur mensuel du compte (budget proxy par
    client, roadmap n°14) et, pour une recherche de campagne, à son activité et à son journal : le
    planificateur classe les activités par prospects par Mo (roadmap n°13).
    Ne doit jamais faire échouer une tâche (base plus ancienne sans la fonction, par exemple)."""
    if nbytes <= 0:
        return
    try:
        conn.execute("select public.lm_add_search_bytes(%s, %s)", (task_id, nbytes))
    except Exception:
        import logging
        logging.getLogger("leadmaker.worker").warning("trafic de la recherche %s non attribué à son activité",
                                                      task_id, exc_info=True)


def previous_task_bytes(conn: psycopg.Connection, task_id: int) -> int:
    row = conn.execute(
        "select coalesce((result ->> 'proxy_bytes')::bigint, 0) as b from public.lm_tasks where id = %s", (task_id,)
    ).fetchone()
    if not row:
        return 0
    return int(row["b"] if isinstance(row, dict) else row[0])


def budget_gb() -> float:
    try:
        return float(os.environ.get("PROXY_DAILY_BUDGET_GB", "3"))
    except ValueError:
        return 3.0


def used_today_bytes(conn: psycopg.Connection) -> int:
    """Octets consommés aujourd'hui (heure de Paris) par les recherches et estimations terminées."""
    row = conn.execute(
        """select coalesce(sum((result ->> 'proxy_bytes')::bigint), 0) as used
             from public.lm_tasks
            where kind in ('discovery', 'estimate')
              and result ? 'proxy_bytes'
              and updated_at >= (date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')"""
    ).fetchone()
    return int(row["used"] if isinstance(row, dict) else row[0])


def seconds_until_tomorrow() -> float:
    now = datetime.now(PARIS)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=1, second=0, microsecond=0)
    return (tomorrow - now).total_seconds()


def check(conn: psycopg.Connection) -> None:
    """Lève BudgetExceeded si la consommation du jour (majorée) atteint le plafond. 0 = pas de plafond."""
    budget = budget_gb()
    if budget <= 0:
        return
    used = used_today_bytes(conn) * OVERHEAD
    if used >= budget * 1e9:
        raise BudgetExceeded(used / 1e9, budget, seconds_until_tomorrow())
