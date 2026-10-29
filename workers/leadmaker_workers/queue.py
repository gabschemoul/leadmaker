"""Accès à la file de tâches Postgres (table public.lm_tasks).

Le worker réserve une tâche avec lm_claim_task (for update skip locked), l'exécute,
puis la clôt avec lm_complete_task ou lm_fail_task. Les trois fonctions sont
SECURITY DEFINER et réservées au rôle service : la connexion doit être celle du
serveur, jamais une clé exposée au navigateur.
"""
from __future__ import annotations

import json
import os
import socket
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


@dataclass
class Task:
    id: int
    account_id: str
    kind: str
    payload: dict[str, Any]
    idempotency_key: str
    attempts: int
    max_attempts: int


def connect() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL manquant")
    return psycopg.connect(url, row_factory=dict_row, autocommit=True)


def worker_id() -> str:
    return os.environ.get("WORKER_ID") or f"{socket.gethostname()}:{os.getpid()}"


def claim(conn: psycopg.Connection, kinds: list[str], worker: str) -> Task | None:
    row = conn.execute(
        "select * from public.lm_claim_task(%s::public.lm_task_kind[], %s)",
        (kinds, worker),
    ).fetchone()
    if not row:
        return None
    payload = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"] or "{}")
    return Task(
        id=row["id"],
        account_id=str(row["account_id"]),
        kind=row["kind"],
        payload=payload,
        idempotency_key=row["idempotency_key"],
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
    )


def complete(conn: psycopg.Connection, task_id: int, result: dict[str, Any]) -> None:
    conn.execute("select public.lm_complete_task(%s, %s)", (task_id, Jsonb(result)))


def fail(conn: psycopg.Connection, task_id: int, error: str) -> None:
    conn.execute("select public.lm_fail_task(%s, %s)", (task_id, error[:2000]))


def enqueue(conn: psycopg.Connection, account_id: str, kind: str, payload: dict[str, Any],
            idempotency_key: str, priority: int = 100) -> int | None:
    """Ajoute une tâche ; renvoie None si la clé existe déjà (idempotence)."""
    row = conn.execute(
        """insert into public.lm_tasks (account_id, kind, payload, idempotency_key, priority)
           values (%s, %s::public.lm_task_kind, %s, %s, %s)
           on conflict (idempotency_key) do nothing
           returning id""",
        (account_id, kind, Jsonb(payload), idempotency_key, priority),
    ).fetchone()
    return row["id"] if row else None
