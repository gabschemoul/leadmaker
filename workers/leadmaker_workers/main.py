"""Boucle principale d'un worker LeadMaker.

    python -m leadmaker_workers.main

Variables : DATABASE_URL, WORKER_KINDS, WORKER_ID, WORKER_IDLE_SECONDS (voir .env.example).
"""
from __future__ import annotations

import logging
import os
import signal
import time

from . import handlers, queue

log = logging.getLogger("leadmaker.worker")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    kinds = [k.strip() for k in os.environ.get("WORKER_KINDS", "dummy").split(",") if k.strip()]
    idle = float(os.environ.get("WORKER_IDLE_SECONDS", "5"))
    worker = queue.worker_id()
    stop = False

    def _stop(*_: object) -> None:
        nonlocal stop
        stop = True
        log.info("arrêt demandé, fin de la tâche en cours")

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    conn = queue.connect()
    log.info("worker %s démarré, types : %s", worker, ", ".join(kinds))

    while not stop:
        try:
            task = queue.claim(conn, kinds, worker)
        except Exception:
            log.exception("file injoignable, nouvel essai dans %ss", idle)
            time.sleep(idle)
            try:
                conn = queue.connect()
            except Exception:
                pass
            continue

        if task is None:
            time.sleep(idle)
            continue

        started = time.monotonic()
        log.info("tâche %s (%s) essai %s/%s", task.id, task.kind, task.attempts, task.max_attempts)
        try:
            result = handlers.run(task)
        except Exception as exc:
            log.exception("tâche %s échouée", task.id)
            queue.fail(conn, task.id, f"{type(exc).__name__}: {exc}")
            continue
        result["duration_ms"] = int((time.monotonic() - started) * 1000)
        queue.complete(conn, task.id, result)
        log.info("tâche %s terminée en %s ms", task.id, result["duration_ms"])

    conn.close()


if __name__ == "__main__":
    main()
