"""Exécution d'une tâche selon son type."""
from __future__ import annotations

import time
from typing import Any

import psycopg

from .queue import Task

_discovery = None
_prepare = None


def prepare_runner():
    global _prepare
    if _prepare is None:
        from .outreach.runner import PrepareRunner

        _prepare = PrepareRunner()
    return _prepare


def discovery_runner():
    global _discovery
    if _discovery is None:
        from .discovery.runner import DiscoveryRunner  # Playwright n'est chargé que pour ce type de tâche

        _discovery = DiscoveryRunner()
    return _discovery


def run_dummy(task: Task, conn: psycopg.Connection) -> dict[str, Any]:
    delay = float(task.payload.get("sleep", 0))
    if delay:
        time.sleep(min(delay, 10))
    if task.payload.get("fail"):
        raise RuntimeError("échec demandé par la charge utile")
    return {"echo": task.payload, "ok": True}


def run_discovery(task: Task, conn: psycopg.Connection) -> dict[str, Any]:
    return discovery_runner().run(task, conn)


def run_estimate(task: Task, conn: psycopg.Connection) -> dict[str, Any]:
    return discovery_runner().estimate(task, conn)


def run_prepare(task: Task, conn: psycopg.Connection) -> dict[str, Any]:
    return prepare_runner().run(task, conn)


def run_send(task: Task, conn: psycopg.Connection) -> dict[str, Any]:
    return prepare_runner().send(task, conn)


def run_emails(task: Task, conn: psycopg.Connection) -> dict[str, Any]:
    return prepare_runner().find_emails(task, conn)


HANDLERS = {
    "dummy": run_dummy,
    "discovery": run_discovery,
    "estimate": run_estimate,
    "prepare": run_prepare,
    "send": run_send,
    "emails": run_emails,
}


def run(task: Task, conn: psycopg.Connection) -> dict[str, Any]:
    handler = HANDLERS.get(task.kind)
    if handler is None:
        raise RuntimeError(f"aucun gestionnaire pour le type de tâche « {task.kind} »")
    return handler(task, conn)


def on_final_failure(task: Task, conn: psycopg.Connection) -> None:
    if task.kind in ("discovery", "estimate"):
        discovery_runner().on_final_failure(task, conn)
    elif task.kind in ("prepare", "send", "emails"):
        prepare_runner().on_final_failure(task, conn)


def shutdown() -> None:
    if _discovery is not None:
        _discovery.close()
