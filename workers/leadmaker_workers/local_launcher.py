"""Veilleur de l'ordinateur dédié : lance et arrête tout seul le robot de recherche sans proxy.

    python -m leadmaker_workers.local_launcher

Démarré à l'ouverture de session par launchd (scripts/install-mac-launcher.sh). Toutes les CHECK_SECONDS, il regarde
dans la vraie base si une campagne EN COURS est marquée « Recherche sur l'ordinateur dédié » (interrupteur de la
page de la campagne) :
- oui, et aucun robot ne tourne → il lance le robot (scripts/run-mac-discovery.sh start) ;
- non, et un robot tourne → il l'arrête (le robot finit sa fiche en cours), le Mac peut se remettre en veille.
Il ne fait aucune recherche lui-même et n'empêche pas la veille. Journal : workers/logs/mac-launcher.log.
"""
from __future__ import annotations

import logging
import os
import signal
import subprocess
import time
from pathlib import Path

import psycopg

log = logging.getLogger("leadmaker.launcher")

WORKERS_DIR = Path(__file__).resolve().parents[1]
SCRIPT = WORKERS_DIR / "scripts" / "run-mac-discovery.sh"
PATTERN = "leadmaker_workers.main mac-discovery"  # marque des robots lancés par run-mac-discovery.sh
CHECK_SECONDS = float(os.environ.get("LAUNCHER_CHECK_SECONDS", "15"))

WANTED_SQL = """
select exists (
  select 1 from public.lm_local_discovery_campaigns l
    join public.lm_campaigns c on c.id = l.campaign_id
   where c.status = 'running'
)"""


def database_url() -> str:
    """Adresse de la vraie base (workers/.env.cloud), par le pooler en mode transaction comme les robots."""
    for line in (WORKERS_DIR / ".env.cloud").read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().replace(":5432/", ":6543/")
    raise RuntimeError("DATABASE_URL absent de workers/.env.cloud")


def robot_running() -> bool:
    out = subprocess.run(["pgrep", "-lf", PATTERN], capture_output=True, text=True).stdout
    return any(line and "caffeinate" not in line for line in out.splitlines())


def script(action: str) -> None:
    result = subprocess.run(["/bin/zsh", str(SCRIPT), action], capture_output=True, text=True, timeout=60)
    for line in (result.stdout + result.stderr).strip().splitlines():
        log.info("  %s", line)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    stop = False

    def _stop(*_: object) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    url = database_url()
    conn: psycopg.Connection | None = None
    last_start = 0.0
    log.info("veilleur démarré : vérification toutes les %.0f s", CHECK_SECONDS)

    while not stop:
        try:
            if conn is None or conn.closed:
                conn = psycopg.connect(url, autocommit=True, prepare_threshold=None, connect_timeout=15)
            wanted = bool(conn.execute(WANTED_SQL).fetchone()[0])
        except Exception as exc:  # réseau coupé, Mac qui sort de veille… on réessaie au tour suivant
            log.warning("base injoignable (%s), nouvel essai dans %.0f s", str(exc).splitlines()[0][:120], CHECK_SECONDS)
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None
        else:
            running = robot_running()
            if wanted and not running and time.monotonic() - last_start > 60:
                # au plus un lancement par minute : un robot qui plante au démarrage n'est pas relancé en boucle
                log.info("campagne à chercher sur ce Mac : lancement du robot")
                last_start = time.monotonic()
                script("start")
            elif not wanted and running:
                log.info("plus aucune campagne en cours sur ce Mac : arrêt du robot")
                script("stop")

        end = time.monotonic() + CHECK_SECONDS
        while not stop and time.monotonic() < end:
            time.sleep(0.5)

    log.info("veilleur arrêté (le robot éventuel continue jusqu'à son arrêt normal)")


if __name__ == "__main__":
    main()
