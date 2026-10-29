"""Tâche « prepare » : remplit le formulaire de contact d'un prospect sans l'envoyer et enregistre le résultat."""
from __future__ import annotations

import base64
import json
import logging
import os
import signal
import subprocess
import sys
import time
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from ..queue import Task
from ..storage import upload_png
from .templates import parse_templates, pick_balanced, render, short_version

log = logging.getLogger("leadmaker.outreach")

# Noms de pays dans les langues les plus fréquentes des formulaires (complétés par le nom anglais en base)
COUNTRY_NAMES = {
    "FR": ["France", "Frankreich", "Francia", "França", "Frankrijk"],
    "US": ["United States", "États-Unis", "Etats-Unis", "USA", "United States of America", "Vereinigte Staaten",
           "Estados Unidos", "Stati Uniti", "Verenigde Staten"],
    "GB": ["United Kingdom", "Royaume-Uni", "UK", "Großbritannien", "Reino Unido", "Regno Unito", "Verenigd Koninkrijk"],
    "DE": ["Germany", "Allemagne", "Deutschland", "Alemania", "Germania", "Alemanha", "Duitsland"],
    "ES": ["Spain", "Espagne", "España", "Spanien", "Spagna", "Espanha", "Spanje"],
    "IT": ["Italy", "Italie", "Italia", "Italien", "Itália", "Italië"],
    "PT": ["Portugal"],
    "BE": ["Belgium", "Belgique", "België", "Belgien", "Bélgica", "Belgio"],
    "CH": ["Switzerland", "Suisse", "Schweiz", "Svizzera", "Suiza", "Suíça"],
    "NL": ["Netherlands", "Pays-Bas", "Nederland", "Niederlande", "Países Bajos", "Paesi Bassi"],
    "CA": ["Canada", "Kanada", "Canadá"],
    "BR": ["Brazil", "Brésil", "Brasil", "Brasilien", "Brasile"],
    "MX": ["Mexico", "Mexique", "México", "Mexiko", "Messico"],
    "AU": ["Australia", "Australie", "Australien", "Austrália"],
    "LU": ["Luxembourg", "Luxemburg", "Luxemburgo"],
    "MA": ["Morocco", "Maroc", "Marruecos", "Marokko", "Marocco"],
}
LOCALES = {
    "FR": "fr-FR", "BE": "fr-BE", "CH": "fr-CH", "LU": "fr-FR", "MA": "fr-FR", "CA": "fr-CA",
    "US": "en-US", "GB": "en-GB", "IE": "en-IE", "AU": "en-AU", "NZ": "en-NZ",
    "DE": "de-DE", "AT": "de-AT", "ES": "es-ES", "MX": "es-MX", "AR": "es-AR", "IT": "it-IT",
    "PT": "pt-PT", "BR": "pt-BR", "NL": "nl-NL", "PL": "pl-PL", "TR": "tr-TR", "SE": "sv-SE", "DK": "da-DK",
}


def _timeout() -> int:
    return int(os.environ.get("PREPARE_TIMEOUT", "180"))


def run_site_job(job: dict, timeout: int) -> dict | None:
    """Lance le site dans un processus à part ; None s'il a fallu le couper (bloqué trop longtemps)."""
    proc = subprocess.Popen([sys.executable, "-m", "leadmaker_workers.outreach.site_job"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, err = proc.communicate(json.dumps(job).encode(), timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # python + Chrome du site
        except OSError:
            pass
        proc.wait()
        return None
    lines = [line for line in out.decode("utf-8", "replace").splitlines() if line.strip()]
    if proc.returncode != 0 or not lines:
        raise RuntimeError(f"site_job terminé avec le code {proc.returncode} : {err.decode('utf-8', 'replace')[-300:]}")
    return json.loads(lines[-1])


class PrepareRunner:
    def run(self, task: Task, conn: psycopg.Connection) -> dict[str, Any]:
        attempt_id = task.payload["attempt_id"]
        row = conn.execute(
            """update public.lm_attempts a set status = 'preparing'
                where a.id = %s and a.status = 'pending'
            returning a.id, a.account_id, a.space_id, a.campaign_id, a.prospect_id, a.extra""",
            (attempt_id,),
        ).fetchone()
        if not row:
            return {"skipped": "tentative plus en attente"}

        prospect = conn.execute(
            "select name, city, category, rating, review_count, website from public.lm_prospects where id = %s",
            (row["prospect_id"],),
        ).fetchone()
        sender = conn.execute(
            """select civility, first_name, last_name, job_title, company, email, phone, website, address, zip, city, country_code
                 from public.lm_sender_profiles where space_id = %s""",
            (row["space_id"],),
        ).fetchone()
        campaign = conn.execute(
            "select templates, country_code from public.lm_campaigns where id = %s", (row["campaign_id"],)
        ).fetchone()
        if not prospect or not sender or not campaign:
            conn.execute("select public.lm_finish_prepare(%s, %s)",
                         (attempt_id, Jsonb({"status": "failed", "detail": "prospect, expéditeur ou campagne introuvable"})))
            return {"status": "failed"}

        messages, short = parse_templates(campaign["templates"])
        counts = {r["template_name"]: r["n"] for r in conn.execute(
            "select template_name, count(*) as n from public.lm_attempts where campaign_id = %s and template_name is not null group by 1",
            (row["campaign_id"],))}
        template = pick_balanced(messages, counts)
        if not template:
            conn.execute("select public.lm_finish_prepare(%s, %s)",
                         (attempt_id, Jsonb({"status": "failed", "detail": "aucun message rédigé dans la campagne"})))
            return {"status": "failed"}

        sender_dict = dict(sender)
        subject = render(template["subject"], prospect, sender_dict)
        body = render(template["body"], prospect, sender_dict)
        short_t = short_version(messages, short)
        short_body = render(short_t["body"], prospect, sender_dict) if short_t and short_t is not template else ""
        country = sender["country_code"] or campaign["country_code"]
        english = (conn.execute("select name from public.lm_country_coverage where country_code = %s", (country,)).fetchone()
                   or {}).get("name")
        names = list(dict.fromkeys(COUNTRY_NAMES.get(country, []) + ([english] if english else [])))
        job = {
            "mode": "prepare", "site": prospect["website"], "subject": subject, "body": body, "short_body": short_body,
            "extra": row["extra"] or {}, "locale": LOCALES.get(campaign["country_code"], "en-US"),
            "headless": os.environ.get("HEADLESS", "true").lower() != "false",
            "sender": {
                "first_name": sender["first_name"], "last_name": sender["last_name"], "company": sender["company"],
                "email": sender["email"], "phone": sender["phone"] or "", "website": sender["website"] or "",
                "city": sender["city"] or "", "zip": sender["zip"] or "", "address": sender["address"] or "",
                "job_title": sender["job_title"] or "", "civility": sender["civility"] or "", "country_names": names,
            },
        }
        started = time.monotonic()
        timeout = _timeout()
        result = run_site_job(job, timeout)
        if result is None:
            result = {"status": "unreachable", "detail": f"site bloqué plus de {timeout} s : passé au suivant"}

        if result.get("short") and short_t:
            template_used, subject, body = short_t["name"], render(short_t["subject"], prospect, sender_dict), short_body
            result["detail"] = "; ".join(filter(None, [result.get("detail", ""), "version courte utilisée (zone de message limitée)"]))
        else:
            template_used = template["name"]

        shot = None
        if result.get("screenshot_b64"):
            path = f"{row['account_id']}/{attempt_id}-before.png"
            try:
                shot = upload_png(path, base64.b64decode(result["screenshot_b64"]))
            except Exception as exc:
                log.warning("capture non enregistrée pour %s : %s", attempt_id, exc)

        finish = {
            "status": result["status"], "template_name": template["name"], "template_used": template_used,
            "subject": subject, "body": body, "form_url": result.get("form_url"), "filled": result.get("filled") or {},
            "missing": result.get("missing") or [], "protection_type": result.get("protection_type"),
            "screenshot_before": shot, "detail": result.get("detail") or None, "found_email": result.get("found_email"),
        }
        conn.execute("select public.lm_finish_prepare(%s, %s)", (attempt_id, Jsonb(finish)))
        log.info("%s → %s (%.1fs) %s", prospect["website"], result["status"], time.monotonic() - started,
                 (result.get("detail") or "")[:120])
        return {"status": result["status"], "found_email": result.get("found_email")}

    def on_final_failure(self, task: Task, conn: psycopg.Connection) -> None:
        conn.execute("select public.lm_finish_prepare(%s, %s)",
                     (task.payload["attempt_id"], Jsonb({"status": "failed", "detail": "erreur répétée du worker"})))


__all__ = ["PrepareRunner"]
