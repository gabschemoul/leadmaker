#!/usr/bin/env python3
"""Change l'adresse IPv4 publique du SERVEUR D'ENVOI (leadmaker-envoi-1), et lui seul.

Pourquoi : les sites voient les formulaires arriver depuis cette adresse ; en changer chaque jour évite
qu'elle finisse sur des listes de blocage.

Déroulé (le serveur d'envoi est coupé ~3 à 6 minutes) :
  1. création d'une nouvelle adresse IPv4 chez Hetzner (pas encore branchée) ;
  2. arrêt propre des robots en cours (chacun termine le site en cours, 3 min au plus) ;
  3. extinction du serveur, retrait de l'ancienne adresse, branchement de la nouvelle, rallumage ;
  4. redémarrage des MÊMES robots qu'avant (ni plus ni moins), contrôle que tout tourne et que les robots
     sortent bien par la nouvelle adresse ;
  5. suppression de l'ancienne adresse (sinon elle resterait facturée), mise à jour du fichier d'adresse.
En cas de problème au milieu, le script remet le serveur en marche (avec l'ancienne adresse si la nouvelle
n'a pas pu être branchée) et envoie un e-mail d'alerte (RESEND_API_KEY + ALERT_EMAIL du fichier .env).

NE TOUCHE JAMAIS au serveur principal : le proxy des recherches est autorisé par son adresse.

Usage :
  python3 workers/scripts/rotate_send_ip.py --dry-run     # montre ce qui serait fait, ne change rien
  python3 workers/scripts/rotate_send_ip.py               # fait la rotation
Lancé chaque nuit par le serveur principal (cron, voir workers/scripts/install-ip-rotation.sh).
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SERVER_NAME = "leadmaker-envoi-1"
# Garde-fous : le serveur principal (proxy autorisé par son adresse) ne doit JAMAIS être touché.
MAIN_SERVER_ID = 173541048
MAIN_SERVER_IP = "2.31.72.125"
API = "https://api.hetzner.cloud/v1"
SAVED_CONTAINERS = "/root/.rotate-running-containers"

WORKERS = Path(__file__).resolve().parent.parent


def log(msg: str) -> None:
    print(f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


class Hetzner:
    def __init__(self, token: str) -> None:
        self.token = token

    def call(self, method: str, path: str, body: dict | None = None, retries: int = 6) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(retries):
            req = urllib.request.Request(API + path, data=data, method=method, headers={
                "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    raw = r.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                try:
                    code = json.loads(text).get("error", {}).get("code", "")
                except ValueError:
                    code = ""
                # serveur occupé par une autre opération, ou limite d'appels : on patiente
                if code in ("locked", "conflict", "rate_limit_exceeded") or e.code >= 500:
                    if attempt < retries - 1:
                        time.sleep(10)
                        continue
                raise RuntimeError(f"Hetzner {method} {path} → {e.code} {text[:300]}") from None
            except urllib.error.URLError as e:
                if attempt < retries - 1:
                    time.sleep(10)
                    continue
                raise RuntimeError(f"Hetzner injoignable ({e.reason})") from None
        raise RuntimeError("Hetzner : trop d'essais")

    def wait_action(self, resp: dict, timeout: int = 300) -> None:
        action = resp.get("action")
        if not action:
            return
        end = time.time() + timeout
        while time.time() < end:
            a = self.call("GET", f"/actions/{action['id']}")["action"]
            if a["status"] == "success":
                return
            if a["status"] == "error":
                raise RuntimeError(f"action {a['command']} en erreur : {a.get('error')}")
            time.sleep(3)
        raise RuntimeError(f"action {action['command']} trop longue")

    def server(self) -> dict:
        servers = self.call("GET", f"/servers?name={SERVER_NAME}")["servers"]
        if len(servers) != 1:
            raise RuntimeError(f"{len(servers)} serveur(s) nommé(s) {SERVER_NAME} : arrêt par prudence")
        s = servers[0]
        ipv4 = (s["public_net"].get("ipv4") or {}).get("ip")
        if s["id"] == MAIN_SERVER_ID or ipv4 == MAIN_SERVER_IP:
            raise RuntimeError("ce serveur est le serveur principal : refus catégorique")
        return s

    def wait_status(self, want: str, timeout: int) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            if self.server()["status"] == want:
                return True
            time.sleep(5)
        return False


class Remote:
    def __init__(self, key: str, known_hosts: str | None) -> None:
        self.key = key
        self.known_hosts = known_hosts

    def run(self, ip: str, command: str, timeout: int = 60) -> str:
        args = ["ssh", "-i", self.key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                "-o", "StrictHostKeyChecking=accept-new"]
        if self.known_hosts:
            args += ["-o", f"UserKnownHostsFile={self.known_hosts}"]
        out = subprocess.run(args + [f"root@{ip}", command], capture_output=True, text=True, timeout=timeout)
        if out.returncode != 0:
            raise RuntimeError(f"ssh {ip} : {out.stderr.strip()[:300] or out.stdout.strip()[:300]}")
        return out.stdout.strip()

    def forget(self, ip: str) -> None:
        args = ["ssh-keygen", "-R", ip]
        if self.known_hosts:
            args += ["-f", self.known_hosts]
        subprocess.run(args, capture_output=True)

    def wait(self, ip: str, timeout: int = 300) -> None:
        end = time.time() + timeout
        last = ""
        while time.time() < end:
            try:
                self.run(ip, "docker info >/dev/null", timeout=30)
                return
            except Exception as e:  # serveur encore en démarrage
                last = str(e)
                time.sleep(5)
        raise RuntimeError(f"serveur injoignable après rallumage ({last})")


def read_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    try:
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


def alert(env_file: Path, subject: str, body: str) -> None:
    env = read_env(env_file)
    key = env.get("RESEND_API_KEY", "")
    to = env.get("ALERT_EMAIL", "")
    if not key or not to:
        log(f"(pas d'e-mail d'alerte possible : RESEND_API_KEY/ALERT_EMAIL absents de {env_file})")
        return
    req = urllib.request.Request("https://api.resend.com/emails", method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        data=json.dumps({"from": env.get("ALERT_FROM", "Prospectigo <noreply@prospectigo.com>"),
                         "to": [to], "subject": subject,
                         "html": f"<pre style='font-family:monospace'>{body}</pre>"}).encode())
    try:
        urllib.request.urlopen(req, timeout=20).read()
        log(f"alerte envoyée à {to}")
    except Exception as e:
        log(f"alerte NON envoyée : {e}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--token-file", default=str(WORKERS / ".hetzner-token"))
    p.add_argument("--ssh-key", default=os.path.expanduser("~/.ssh/leadmaker_hetzner"))
    p.add_argument("--known-hosts", default=None)
    p.add_argument("--env-file", default=str(WORKERS / ".env"), help="pour l'e-mail d'alerte")
    p.add_argument("--ip-file", default=str(WORKERS / ".send-server-ip"))
    a = p.parse_args()

    lock = open("/tmp/leadmaker-rotate-send-ip.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("une rotation est déjà en cours : rien à faire")
        return 0

    h = Hetzner(Path(a.token_file).read_text().strip())
    r = Remote(a.ssh_key, a.known_hosts)
    env_file = Path(a.env_file)

    s = h.server()
    sid = s["id"]
    old = s["public_net"]["ipv4"]
    location = s["location"]["name"] if s.get("location") else s["datacenter"]["location"]["name"]
    log(f"serveur {SERVER_NAME} (id {sid}, {location}) : statut {s['status']}, adresse actuelle {old['ip']}")
    if s["status"] != "running":
        raise RuntimeError(f"serveur {s['status']} (pas « running ») : je ne touche à rien")

    running = r.run(old["ip"], "docker ps -q | wc -l")
    log(f"{running} robots tournent")
    if a.dry_run:
        log("simulation : je créerais une nouvelle adresse IPv4 à "
            f"{location}, j'arrêterais ces {running} robots, j'éteindrais le serveur, je remplacerais "
            f"{old['ip']} par la nouvelle, je rallumerais, je relancerais les mêmes robots, "
            "puis je supprimerais l'ancienne adresse.")
        return 0

    # 1. nouvelle adresse (pas encore branchée). Si Hetzner en donne une signalée « bloquée », on en reprend une.
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M")
    new = None
    for i in range(3):
        created = h.call("POST", "/primary_ips", {
            "name": f"envoi-{stamp}" + (f"-{i}" if i else ""), "type": "ipv4", "assignee_type": "server",
            "location": location, "auto_delete": True, "labels": {"role": "envoi"}})["primary_ip"]
        if not created.get("blocked") and created["ip"] != MAIN_SERVER_IP:
            new = created
            break
        log(f"adresse {created['ip']} signalée bloquée : supprimée, nouvel essai")
        h.call("DELETE", f"/primary_ips/{created['id']}")
    if new is None:
        raise RuntimeError("pas d'adresse propre après 3 essais : rien n'a été changé")
    log(f"nouvelle adresse réservée : {new['ip']}")

    switched = False   # la nouvelle adresse est-elle branchée ?
    current_ip = old["ip"]
    try:
        # 2. arrêt propre : on note les robots qui tournent pour relancer exactement les mêmes
        log("arrêt propre des robots (chacun termine son site, 3 min au plus)…")
        r.run(current_ip, f"docker ps -q > {SAVED_CONTAINERS} && "
                          f"[ ! -s {SAVED_CONTAINERS} ] || docker stop -t 200 $(cat {SAVED_CONTAINERS}) >/dev/null",
              timeout=400)

        # 3. extinction, échange d'adresse, rallumage
        log("extinction du serveur…")
        h.wait_action(h.call("POST", f"/servers/{sid}/actions/shutdown"))
        if not h.wait_status("off", 180):
            log("extinction douce trop longue : coupure")
            h.wait_action(h.call("POST", f"/servers/{sid}/actions/poweroff"))
            if not h.wait_status("off", 120):
                raise RuntimeError("le serveur ne s'éteint pas")
        h.wait_action(h.call("POST", f"/primary_ips/{old['id']}/actions/unassign"))
        log(f"ancienne adresse {old['ip']} retirée")
        h.wait_action(h.call("POST", f"/primary_ips/{new['id']}/actions/assign",
                             {"assignee_id": sid, "assignee_type": "server"}))
        switched = True
        current_ip = new["ip"]
        log(f"nouvelle adresse {new['ip']} branchée, rallumage…")
        h.wait_action(h.call("POST", f"/servers/{sid}/actions/poweron"))
        if not h.wait_status("running", 180):
            raise RuntimeError("le serveur ne se rallume pas")
        r.forget(new["ip"])
        r.wait(current_ip)

        # 4. mêmes robots qu'avant, puis contrôles
        r.run(current_ip, f"[ ! -s {SAVED_CONTAINERS} ] || docker start $(cat {SAVED_CONTAINERS}) >/dev/null", timeout=300)
        time.sleep(20)
        before = r.run(current_ip, f"wc -l < {SAVED_CONTAINERS}")
        after = r.run(current_ip, "docker ps -q | wc -l")
        if int(after) < int(before):
            raise RuntimeError(f"seulement {after} robots sur {before} ont redémarré")
        seen = r.run(current_ip, "docker exec $(head -1 " + SAVED_CONTAINERS + ") python3 -c "
                     + shlex.quote("import urllib.request;print(urllib.request.urlopen('https://api.ipify.org',timeout=15).read().decode())"),
                     timeout=60)
        if seen != new["ip"]:
            raise RuntimeError(f"les robots sortent par {seen}, pas par {new['ip']}")
        log(f"{after} robots relancés, ils sortent bien par {seen}")
    except Exception as e:
        log(f"ÉCHEC : {e} → remise en marche")
        notes = [f"Erreur : {e}"]
        try:
            if not switched:
                # la nouvelle adresse n'a pas été branchée : on remet l'ancienne si besoin
                if not h.server()["public_net"].get("ipv4"):
                    if h.wait_status("off", 5):
                        h.wait_action(h.call("POST", f"/primary_ips/{old['id']}/actions/assign",
                                             {"assignee_id": sid, "assignee_type": "server"}))
                current_ip = old["ip"]
                h.call("DELETE", f"/primary_ips/{new['id']}")
                notes.append(f"Ancienne adresse gardée ({old['ip']}), nouvelle supprimée.")
            if h.server()["status"] != "running":
                h.wait_action(h.call("POST", f"/servers/{sid}/actions/poweron"))
                h.wait_status("running", 180)
            r.wait(current_ip)
            r.run(current_ip, f"[ ! -s {SAVED_CONTAINERS} ] || docker start $(cat {SAVED_CONTAINERS}) >/dev/null", timeout=300)
            notes.append(f"Serveur rallumé ({current_ip}), robots relancés : {r.run(current_ip, 'docker ps -q | wc -l')}.")
        except Exception as e2:
            notes.append(f"Remise en marche INCOMPLÈTE : {e2}. À vérifier à la main dans la console Hetzner.")
        if switched:
            notes.append(f"L'ancienne adresse {old['ip']} n'a PAS été supprimée (onglet Primary IPs).")
            Path(a.ip_file).write_text(current_ip + "\n")
        log(" | ".join(notes))
        alert(env_file, "Prospectigo : rotation de l'adresse du serveur d'envoi en échec", "\n".join(notes))
        return 1

    # 5. ménage : l'ancienne adresse n'est plus branchée nulle part, on la supprime
    try:
        h.call("DELETE", f"/primary_ips/{old['id']}")
        log(f"ancienne adresse {old['ip']} supprimée")
    except Exception as e:
        log(f"ancienne adresse {old['ip']} non supprimée : {e}")
        alert(env_file, "Prospectigo : ancienne adresse du serveur d'envoi à supprimer",
              f"Rotation réussie ({new['ip']}) mais {old['ip']} n'a pas pu être supprimée : {e}")
    r.forget(old["ip"])
    Path(a.ip_file).write_text(new["ip"] + "\n")
    log(f"terminé : serveur d'envoi sur {new['ip']} (noté dans {a.ip_file})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # erreur AVANT toute modification
        log(f"ÉCHEC avant tout changement : {e}")
        args = sys.argv[1:]
        env_file = Path(args[args.index("--env-file") + 1]) if "--env-file" in args else WORKERS / ".env"
        if "--dry-run" not in args:
            alert(env_file, "Prospectigo : rotation de l'adresse du serveur d'envoi non faite", str(e))
        sys.exit(1)
