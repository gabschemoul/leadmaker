"""Plafond quotidien de consommation du proxy résidentiel (facturé au volume).

Chaque recherche Google Maps mesure ce qu'elle télécharge à travers le proxy et l'enregistre dans le
résultat de sa tâche (`proxy_bytes`). Avant chaque recherche, le robot additionne la consommation du
jour (heure de Paris) ; au-delà de PROXY_DAILY_BUDGET_GB (3 Go par défaut), il remet la recherche à
plus tard et se met en pause jusqu'au lendemain. Un forfait ne peut donc plus se vider en une soirée.

La mesure compte les octets reçus par le navigateur ; le fournisseur facture aussi l'envoi et le
chiffrement : on majore de 15 % pour rester du bon côté.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg

PARIS = ZoneInfo("Europe/Paris")
OVERHEAD = 1.15


class BudgetExceeded(RuntimeError):
    """Plafond quotidien de proxy atteint : la recherche attend le lendemain."""

    def __init__(self, used_gb: float, budget_gb: float, seconds_left: float):
        super().__init__(f"plafond proxy du jour atteint ({used_gb:.2f} Go sur {budget_gb:.2f} Go)")
        self.seconds_left = seconds_left


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
