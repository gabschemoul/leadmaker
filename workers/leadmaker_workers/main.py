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

from . import handlers, proxy_budget, queue

log = logging.getLogger("leadmaker.worker")
PROXY_KINDS = ("discovery", "estimate")  # tâches qui passent par le proxy résidentiel (facturé au volume)

OUTAGE_WAITS = (60, 120, 300, 600, 900)  # secondes d'attente après 1, 2, 3, 4, 5+ pannes de proxy d'affilée


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    kinds = [k.strip() for k in os.environ.get("WORKER_KINDS", "dummy").split(",") if k.strip()]
    idle = float(os.environ.get("WORKER_IDLE_SECONDS", "5"))
    base_backoff = float(os.environ.get("BLOCK_BACKOFF_MINUTES", "30"))
    worker = queue.worker_id()
    stop = False
    backoff = 0.0
    outage = 0  # pannes de proxy d'affilée
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
        net_before = proxy_budget.network_bytes() if task.kind in PROXY_KINDS else None

        def spent() -> int:
            after = proxy_budget.network_bytes() if net_before is not None else None
            return max(after - net_before, 0) if after is not None else 0

        try:
            result = handlers.run(task, conn)
        except Exception as exc:
            if net_before is not None:
                try:
                    used = spent()
                    if type(exc).__name__ == "BudgetExceeded":
                        used = 0  # rien n'a été téléchargé : le plafond est vérifié avant la recherche
                    proxy_budget.add_task_bytes(conn, task.id, used)
                except Exception:
                    log.exception("consommation du proxy non enregistrée")
            if "crashed" in str(exc).lower():
                handlers.shutdown()  # onglet ou navigateur planté (mémoire) : on repart d'un navigateur neuf
            if type(exc).__name__ == "BudgetExceeded":
                # Plafond quotidien de proxy atteint : la recherche attend le lendemain, ce robot aussi
                wait = float(getattr(exc, "seconds_left", 3600))
                queue.requeue(conn, task.id, delay_seconds=wait, error=str(exc))
                log.warning("%s : recherches en pause jusqu'à demain (%d min)", exc, wait // 60)
                handlers.shutdown()
                pause(min(wait, 3600))
                continue
            if type(exc).__name__ == "ProxyDown":
                # Proxy ou réseau en panne : la recherche n'y est pour rien. Elle repart sans perdre d'essai
                # (aucun quartier sauté) et le robot attend 1, 2, 5, 10 puis 15 min avant de réessayer.
                wait = OUTAGE_WAITS[min(outage, len(OUTAGE_WAITS) - 1)]
                outage += 1
                queue.requeue(conn, task.id, delay_seconds=wait, error=str(exc))
                log.warning("PANNE PROXY (%d d'affilée) : %s — recherche remise en file, pause de %d min",
                            outage, exc, wait // 60)
                handlers.shutdown()
                pause(wait)
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
        outage = 0
        if net_before is not None:
            try:
                result["proxy_bytes_browser"] = result.get("proxy_bytes")
                result["proxy_bytes"] = proxy_budget.previous_task_bytes(conn, task.id) + spent()
            except Exception:
                log.exception("consommation du proxy non mesurée")
        result["duration_ms"] = int((time.monotonic() - started) * 1000)
        queue.complete(conn, task.id, result)
        if net_before is not None and "proxy_bytes" in result:
            log.info("tâche %s terminée en %s ms, %.1f Mo de trafic réel", task.id, result["duration_ms"],
                     result["proxy_bytes"] / 1e6)
        else:
            log.info("tâche %s terminée en %s ms", task.id, result["duration_ms"])

    handlers.shutdown()
    conn.close()


if __name__ == "__main__":
    main()
