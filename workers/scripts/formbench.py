"""Banc de test de la recherche de formulaires : passe une liste de sites dans le robot (mode « prepare »,
rien n'est envoyé) et enregistre le résultat de chacun pour mesurer le taux de formulaires trouvés.

    .venv/bin/python scripts/formbench.py sites.txt -o data/bench/run.json [-j 8] [--only no_form,unreachable]
    .venv/bin/python scripts/formbench.py --compare data/bench/avant.json data/bench/apres.json

Le fichier d'entrée contient une adresse par ligne. Avec --only, seuls les sites dont le statut dans
--previous <run.json> est dans la liste sont rejoués (pour vérifier une correction sans tout relancer).
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SENDER = {"first_name": "Laurie", "last_name": "Test", "company": "Agence Test", "email": "laurie@agence-test.example",
          "phone": "0600000000", "website": "https://agence-test.example", "city": "Lyon", "zip": "69001",
          "address": "1 rue du Test", "job_title": "Gérante", "civility": "mrs", "country_names": ["France"]}
BODY = ("Bonjour, je suis Laurie de Agence Test. Ceci est un message de test du banc d'essai : "
        "il n'est jamais envoyé. Merci de l'ignorer. Cordialement, Laurie Test")


def run_site(site: str, timeout: int) -> dict:
    job = {"mode": "prepare", "site": site, "sender": SENDER, "subject": "Test banc d'essai", "body": BODY,
           "short_body": "Message court de test (jamais envoyé).", "extra": {}, "locale": "fr-FR", "headless": True}
    started = time.monotonic()
    proc = subprocess.Popen([sys.executable, "-m", "leadmaker_workers.outreach.site_job"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, cwd=ROOT)
    try:
        out, err = proc.communicate(json.dumps(job).encode(), timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.wait()
        return {"site": site, "status": "timeout", "detail": f"coupé après {timeout} s",
                "seconds": round(time.monotonic() - started, 1)}
    lines = [line for line in out.decode("utf-8", "replace").splitlines() if line.strip()]
    if proc.returncode != 0 or not lines:
        return {"site": site, "status": "crash", "detail": err.decode("utf-8", "replace")[-300:],
                "seconds": round(time.monotonic() - started, 1)}
    result = json.loads(lines[-1])
    result.pop("screenshot_b64", None)
    result.update(site=site, seconds=round(time.monotonic() - started, 1))
    return result


def summary(results: list[dict]) -> str:
    counts = Counter(r["status"] for r in results)
    secs: dict[str, list[float]] = defaultdict(list)
    for r in results:
        secs[r["status"]].append(r.get("seconds", 0))
    total = len(results) or 1
    lines = [f"{len(results)} sites"]
    for status, n in counts.most_common():
        avg = sum(secs[status]) / len(secs[status])
        lines.append(f"  {status:24s} {n:4d}  ({100 * n / total:5.1f} %)  {avg:5.1f} s en moyenne")
    found = sum(counts[s] for s in ("ready", "incomplete", "intervention_required"))
    lines.append(f"  formulaire trouvé : {found} / {len(results)} = {100 * found / total:.1f} %")
    lines.append(f"  durée moyenne : {sum(r.get('seconds', 0) for r in results) / total:.1f} s")
    return "\n".join(lines)


def compare(before: list[dict], after: list[dict]) -> str:
    a = {r["site"]: r for r in before}
    b = {r["site"]: r for r in after}
    changed = [(s, a[s]["status"], b[s]["status"]) for s in b if s in a and a[s]["status"] != b[s]["status"]]
    lines = [f"{len(changed)} changements de statut"]
    for site, old, new in sorted(changed, key=lambda x: (x[1], x[2])):
        lines.append(f"  {old:22s} → {new:22s} {site}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sites", nargs="?")
    ap.add_argument("-o", "--output")
    ap.add_argument("-j", "--jobs", type=int, default=6)
    ap.add_argument("-t", "--timeout", type=int, default=150)
    ap.add_argument("--previous", help="résultat précédent, pour --only")
    ap.add_argument("--only", help="statuts à rejouer (séparés par des virgules)")
    ap.add_argument("--compare", nargs=2, metavar=("AVANT", "APRES"))
    args = ap.parse_args()

    if args.compare:
        before = json.loads(Path(args.compare[0]).read_text())
        after = json.loads(Path(args.compare[1]).read_text())
        print(summary(after))
        print(compare(before, after))
        return

    sites = [line.strip() for line in Path(args.sites).read_text().splitlines() if line.strip()]
    previous: dict[str, dict] = {}
    if args.previous:
        previous = {r["site"]: r for r in json.loads(Path(args.previous).read_text())}
    if args.only:
        wanted = set(args.only.split(","))
        sites = [s for s in sites if previous.get(s, {}).get("status") in wanted]

    out_path = Path(args.output) if args.output else None
    if out_path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(run_site, s, args.timeout): s for s in sites}
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            results.append(r)
            print(f"[{i}/{len(sites)}] {r['status']:22s} {r.get('seconds', 0):5.1f}s  {r['site']}  {(r.get('detail') or '')[:90]}",
                  flush=True)
            if out_path and i % 10 == 0:
                out_path.write_text(json.dumps(results, ensure_ascii=False, indent=1))
    # les sites non rejoués gardent leur résultat précédent (comparaison complète)
    if args.only:
        done = {r["site"] for r in results}
        results += [r for s, r in previous.items() if s not in done]
    if out_path:
        out_path.write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(f"\nterminé en {time.monotonic() - started:.0f} s")
    print(summary(results))


if __name__ == "__main__":
    main()
