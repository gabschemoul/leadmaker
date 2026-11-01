"""Boucle principale d'un worker LeadMaker.

    python -m leadmaker_workers.main

Variables : DATABASE_URL, WORKER_KINDS (ex. « discovery »), WORKER_ID, WORKER_IDLE_SECONDS,
HEADLESS (true/false), SCRAPE_DELAY (secondes), PROXY_URL (facultatif), BLOCK_BACKOFF_MINUTES,
PROXY_DAILY_BUDGET_GB (plafond quotidien du proxy, 3 Go par défaut, 0 = sans plafond).
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
    base_backoff = float(os.environ.get("BLOCK_BACKOFF_MINUTES", "30"))
    worker = queue.worker_id()
    stop = False
    backoff = 0.0
    last_housekeeping = 0.0

    def _stop(*_: object) -> None:
        nonlocal stop
        stop = True
        log.info("arrêt demandé, fin de la tâche en cours")

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    conn = queue.connect()
    log.info("worker %s démarré, types : %s", worker, ", ".join(kinds))

    def pause(seconds: float) -> None:
        end = time.monotonic() + seconds
        while not stop and time.monotonic() < end:
            time.sleep(min(1.0, end - time.monotonic()))

    while not stop:
        try:
            if time.monotonic() - last_housekeeping > 300:
                conn.execute("select public.lm_requeue_stale_tasks()")
                last_housekeeping = time.monotonic()
            if "discovery" in kinds:
                conn.execute("select public.lm_schedule_discovery()")
            if "send" in kinds:
                conn.execute("select public.lm_queue_sends()")
            task = queue.claim(conn, kinds, worker)
        except Exception:
            log.exception("file injoignable, nouvel essai dans %ss", idle)
            pause(idle)
            try:
                conn = queue.connect()
            except Exception:
                pass
            continue

        if task is None:
            pause(idle)
            continue

        started = time.monotonic()
        log.info("tâche %s (%s) essai %s/%s", task.id, task.kind, task.attempts, task.max_attempts)
        try:
            result = handlers.run(task, conn)
        except Exception as exc:
            if type(exc).__name__ == "BudgetExceeded":
                # Plafond quotidien de proxy atteint : la recherche attend le lendemain, ce robot aussi
                wait = float(getattr(exc, "seconds_left", 3600))
                queue.requeue(conn, task.id, delay_seconds=wait, error=str(exc))
                log.warning("%s : recherches en pause jusqu'à demain (%d min)", exc, wait // 60)
                handlers.shutdown()
                pause(min(wait, 3600))
                continue
            if type(exc).__name__ == "BlockedError":
                # Captcha Google : la tâche repart sans compter d'essai, ce worker se met en pause (30, 60, 120, 240 min)
                backoff = min(max(backoff * 2, base_backoff), 240)
                queue.requeue(conn, task.id, delay_seconds=backoff * 60, error=str(exc))
                log.warning("bloqué par Google : pause de %d min", backoff)
                handlers.shutdown()
                pause(backoff * 60)
                continue
            log.exception("tâche %s échouée", task.id)
            queue.fail(conn, task.id, f"{type(exc).__name__}: {exc}")
            if task.attempts >= task.max_attempts:
                try:
                    handlers.on_final_failure(task, conn)
                except Exception:
                    log.exception("nettoyage après échec définitif impossible")
            continue

        backoff = 0.0
        result["duration_ms"] = int((time.monotonic() - started) * 1000)
        queue.complete(conn, task.id, result)
        log.info("tâche %s terminée en %s ms", task.id, result["duration_ms"])

    handlers.shutdown()
    conn.close()


if __name__ == "__main__":
    main()
