"""Exécution d'une tâche selon son type.

Lot 0 : seule la tâche « dummy » existe ; elle prouve la boucle réserver → exécuter → écrire.
Les tâches discovery / prepare / send arrivent aux lots 1 et 2 (moteurs du prototype).
"""
from __future__ import annotations

import time
from typing import Any

from .queue import Task


def run_dummy(task: Task) -> dict[str, Any]:
    delay = float(task.payload.get("sleep", 0))
    if delay:
        time.sleep(min(delay, 10))
    if task.payload.get("fail"):
        raise RuntimeError("échec demandé par la charge utile")
    return {"echo": task.payload, "ok": True}


HANDLERS = {
    "dummy": run_dummy,
}


def run(task: Task) -> dict[str, Any]:
    handler = HANDLERS.get(task.kind)
    if handler is None:
        raise RuntimeError(f"aucun gestionnaire pour le type de tâche « {task.kind} »")
    return handler(task)
