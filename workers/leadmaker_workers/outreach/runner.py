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
from urllib.parse import urlparse

import psycopg
from psycopg.types.json import Jsonb

from ..queue import Task
from ..storage import upload_png
from . import ai_check
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


# Pages sur un réseau social ou un annuaire : pas de formulaire de contact, inutile de les visiter
NO_FORM_HOSTS = ("facebook.com", "fb.com", "instagram.com", "linkedin.com", "tiktok.com", "twitter.com", "x.com",
                 "youtube.com", "pagesjaunes.fr", "yelp.com", "yelp.fr", "linktr.ee", "wa.me", "t.me")


def _social_host(url: str) -> bool:
    host = (urlparse(url if "://" in url else f"http://{url}").hostname or "").lower().removeprefix("www.")
    return any(host == h or host.endswith("." + h) for h in NO_FORM_HOSTS)


def _timeout() -> int:
    return int(os.environ.get("PREPARE_TIMEOUT", "100"))


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


# Entreprise à contacter, avec le nom de son groupe dans la campagne (variable {groupe}, 10/11/2026)
PROSPECT_SQL = """select p.name, p.city, p.category, p.rating, p.review_count, p.website,
                         (select g ->> 'label' from public.lm_campaigns c
                                 join public.lm_campaign_prospects cp on cp.campaign_id = c.id and cp.prospect_id = p.id,
                                 jsonb_array_elements(c.sort_groups) g
                           where c.id = %s and g ->> 'key' = cp.group_key limit 1) as "group"
                    from public.lm_prospects p where p.id = %s"""


def _group_message_names(conn: psycopg.Connection, campaign_id: Any, prospect_id: Any) -> list[str] | None:
    """Messages utilisables pour cette entreprise selon son groupe (lm_campaign_message_names) ; None si la base
    n'a pas encore la fonction ou si la campagne n'a aucun message : on garde alors tous les messages."""
    try:
        row = conn.execute(
            """select public.lm_campaign_message_names(%s,
                      (select cp.group_key from public.lm_campaign_prospects cp
                        where cp.campaign_id = %s and cp.prospect_id = %s)) as names""",
            (campaign_id, campaign_id, prospect_id),
        ).fetchone()
    except psycopg.Error as exc:
        log.warning("messages par groupe non lus (%s) : tous les messages restent possibles", str(exc).splitlines()[0])
        return None
    return list(row["names"]) if row and row["names"] else None


def _load_context(conn: psycopg.Connection, row: dict):
    """Prospect, expéditeur, campagne et expéditeur prêt pour le navigateur (None si incomplet)."""
    prospect = conn.execute(PROSPECT_SQL, (row["campaign_id"], row["prospect_id"])).fetchone()
    # Expéditeur de la campagne (choisi pour elle, sinon celui par défaut de l'espace : lm_campaign_sender)
    sender = conn.execute(
        """select civility, first_name, last_name, job_title, company, email, phone, website, address, zip, city, country_code
             from public.lm_campaign_sender(%s)""",
        (row["campaign_id"],),
    ).fetchone()
    campaign = conn.execute(
        "select templates, country_code from public.lm_campaigns where id = %s", (row["campaign_id"],)
    ).fetchone()
    if not prospect or not sender or not campaign:
        return None
    country = sender["country_code"] or campaign["country_code"]
    english = (conn.execute("select name from public.lm_country_coverage where country_code = %s", (country,)).fetchone()
               or {}).get("name")
    names = list(dict.fromkeys(COUNTRY_NAMES.get(country, []) + ([english] if english else [])))
    sender_job = {
        "first_name": sender["first_name"], "last_name": sender["last_name"], "company": sender["company"],
        "email": sender["email"], "phone": sender["phone"] or "", "website": sender["website"] or "",
        "city": sender["city"] or "", "zip": sender["zip"] or "", "address": sender["address"] or "",
        "job_title": sender["job_title"] or "", "civility": sender["civility"] or "", "country_names": names, "country_code": country or "",
    }
    return prospect, dict(sender), campaign, sender_job


class PrepareRunner:
    def send(self, task: Task, conn: psycopg.Connection) -> dict[str, Any]:
        """Envoi d'une tentative validée. Jamais deux fois : une tentative déjà « en envoi » passe « à vérifier »."""
        attempt_id = task.payload["attempt_id"]
        row = conn.execute(
            """update public.lm_attempts a set status = 'sending'
                where a.id = %s and a.status = 'validated'
            returning a.id, a.account_id, a.space_id, a.campaign_id, a.prospect_id, a.extra, a.subject, a.body,
                      a.form_url, a.template_name, a.template_used""",
            (attempt_id,),
        ).fetchone()
        if not row:
            current = conn.execute("select status from public.lm_attempts where id = %s", (attempt_id,)).fetchone()
            if current and current["status"] == "sending":
                conn.execute("select public.lm_finish_send(%s, %s)", (attempt_id, Jsonb(
                    {"status": "to_verify", "submitted": False,
                     "detail": "envoi interrompu : vérifiez sur le site si le message est parti"})))
            return {"skipped": "tentative non validée"}

        ctx = _load_context(conn, row)
        if not ctx:
            conn.execute("select public.lm_finish_send(%s, %s)", (attempt_id, Jsonb(
                {"status": "failed", "submitted": False, "detail": "prospect, expéditeur ou campagne introuvable"})))
            return {"status": "failed"}
        prospect, sender_dict, campaign, sender_job = ctx
        messages, short = parse_templates(campaign["templates"])
        template = next((m for m in messages if m["name"] == row["template_name"]), None)
        short_t = short_version(template, messages, short)
        short_body = render(short_t["body"], prospect, sender_dict) if short_t else ""
        job = {
            "mode": "send", "site": prospect["website"], "form_url": row["form_url"], "subject": row["subject"] or "",
            "body": row["body"] or "", "short_body": short_body if row["template_used"] != (short_t or {}).get("name") else "",
            "extra": row["extra"] or {}, "locale": LOCALES.get(campaign["country_code"], "en-US"),
            "headless": os.environ.get("HEADLESS", "true").lower() != "false", "sender": sender_job,
        }
        started = time.monotonic()
        result = run_site_job(job, _timeout())
        if result is None:
            result = {"status": "to_verify", "submitted": True,
                      "detail": f"envoi bloqué plus de {_timeout()} s : vérifiez sur le site si le message est parti"}
        shot = None
        if result.get("screenshot_b64"):
            try:
                shot = upload_png(f"{row['account_id']}/{attempt_id}-after.png", base64.b64decode(result["screenshot_b64"]))
            except Exception as exc:
                log.warning("capture après envoi non enregistrée pour %s : %s", attempt_id, exc)
        finish = {
            "status": result["status"], "submitted": bool(result.get("submitted")), "detail": result.get("detail") or None,
            "protection_type": result.get("protection_type"), "screenshot_after": shot,
            "missing": result.get("missing") if result.get("status") == "incomplete" else None,
        }
        if result.get("short") and short_t:
            finish.update(template_used=short_t["name"], body=short_body,
                          subject=render(short_t["subject"], prospect, sender_dict))
        conn.execute("select public.lm_finish_send(%s, %s)", (attempt_id, Jsonb(finish)))
        log.info("ENVOI %s → %s (%.1fs) %s", prospect["website"], result["status"], time.monotonic() - started,
                 (result.get("detail") or "")[:120])
        return {"status": result["status"], "submitted": finish["submitted"]}

    def run(self, task: Task, conn: psycopg.Connection) -> dict[str, Any]:
        attempt_id = task.payload["attempt_id"]
        # Nouvel essai après un plantage du robot (navigateur tué, serveur redémarré) : la tentative est restée
        # « preparing » ; on la reprend au lieu de la laisser bloquée pour toujours (audit 5/11/2026, A17).
        row = conn.execute(
            """update public.lm_attempts a set status = 'preparing'
                where a.id = %s and (a.status = 'pending' or (a.status = 'preparing' and %s > 1))
            returning a.id, a.account_id, a.space_id, a.campaign_id, a.prospect_id, a.extra, a.template_name,
                      to_jsonb(a) ->> 'autopilot_id' as autopilot_id""",
            (attempt_id, task.attempts),
        ).fetchone()
        if not row:
            return {"skipped": "tentative plus en attente"}

        prospect = conn.execute(PROSPECT_SQL, (row["campaign_id"], row["prospect_id"])).fetchone()
        # Expéditeur de la campagne (choisi pour elle, sinon celui par défaut de l'espace : lm_campaign_sender)
        sender = conn.execute(
            """select civility, first_name, last_name, job_title, company, email, phone, website, address, zip, city, country_code
                 from public.lm_campaign_sender(%s)""",
            (row["campaign_id"],),
        ).fetchone()
        campaign = conn.execute(
            "select templates, country_code from public.lm_campaigns where id = %s", (row["campaign_id"],)
        ).fetchone()
        if not prospect or not sender or not campaign:
            conn.execute("select public.lm_finish_prepare(%s, %s)",
                         (attempt_id, Jsonb({"status": "failed", "detail": "prospect, expéditeur ou campagne introuvable"})))
            return {"status": "failed"}

        all_messages, short = parse_templates(campaign["templates"])
        messages = all_messages
        counts = {r["template_name"]: r["n"] for r in conn.execute(
            "select template_name, count(*) as n from public.lm_attempts where campaign_id = %s and template_name is not null group by 1",
            (row["campaign_id"],))}
        # Pilote automatique (roadmap n°18) : le message est choisi à l'avance (test A/B à parts égales entre les
        # messages cochés). S'il a été renommé depuis, on choisit parmi les seuls messages cochés du pilote.
        # Mode Avancé : rotation équilibrée sur tous les messages, comme avant.
        # (to_jsonb : ce code tourne aussi sur une base qui n'a pas encore la colonne autopilot_id)
        if row.get("autopilot_id"):
            pilot = conn.execute("select messages from public.lm_autopilots where id = %s",
                                 (row["autopilot_id"],)).fetchone()
            chosen = set(pilot["messages"]) if pilot else set()
            messages = [m for m in messages if m["name"] in chosen]
        # message choisi à l'avance (pilote) : cherché parmi TOUS les messages, il peut venir du groupe de
        # l'entreprise sans être coché (lm_autopilot_tick)
        preset = next((m for m in all_messages if m["name"] == row.get("template_name")), None)
        if not preset:
            # « Un message par groupe » (10/11/2026) : seulement les messages du groupe de l'entreprise
            names = _group_message_names(conn, row["campaign_id"], row["prospect_id"])
            if names:
                messages = ([m for m in messages if m["name"] in names]
                            or [m for m in all_messages if m["name"] in names] or messages)
        template = preset or pick_balanced(messages, counts)
        if not template:
            detail = ("les messages choisis pour le pilote automatique n'existent plus (étape Rédiger)"
                      if row.get("autopilot_id") else "aucun message rédigé dans la campagne")
            conn.execute("select public.lm_finish_prepare(%s, %s)", (attempt_id, Jsonb({"status": "failed", "detail": detail})))
            return {"status": "failed"}

        sender_dict = dict(sender)
        subject = render(template["subject"], prospect, sender_dict)
        body = render(template["body"], prospect, sender_dict)
        short_t = short_version(template, messages, short)
        short_body = render(short_t["body"], prospect, sender_dict) if short_t and short_t is not template else ""
        country = sender["country_code"] or campaign["country_code"]
        english = (conn.execute("select name from public.lm_country_coverage where country_code = %s", (country,)).fetchone()
                   or {}).get("name")
        names = list(dict.fromkeys(COUNTRY_NAMES.get(country, []) + ([english] if english else [])))
        job = {
            "mode": "prepare", "site": prospect["website"], "name": prospect["name"], "subject": subject, "body": body,
            "short_body": short_body,
            "extra": row["extra"] or {}, "locale": LOCALES.get(campaign["country_code"], "en-US"),
            "headless": os.environ.get("HEADLESS", "true").lower() != "false",
            "sender": {
                "first_name": sender["first_name"], "last_name": sender["last_name"], "company": sender["company"],
                "email": sender["email"], "phone": sender["phone"] or "", "website": sender["website"] or "",
                "city": sender["city"] or "", "zip": sender["zip"] or "", "address": sender["address"] or "",
                "job_title": sender["job_title"] or "", "civility": sender["civility"] or "", "country_names": names, "country_code": country or "",
            },
        }
        started = time.monotonic()
        timeout = _timeout()
        if _social_host(prospect["website"] or ""):
            result = {"status": "no_form", "detail": "page sur un réseau social ou un annuaire : pas de formulaire de contact"}
        else:
            result = run_site_job(job, timeout)
        if result is None:
            result = {"status": "unreachable", "detail": f"site bloqué plus de {timeout} s : passé au suivant"}

        if result.get("short") and short_t:
            template_used, subject, body = short_t["name"], render(short_t["subject"], prospect, sender_dict), short_body
            result["detail"] = "; ".join(filter(None, [result.get("detail", ""), "version courte utilisée (zone de message limitée)"]))
        else:
            template_used = template["name"]

        # contrôle IA avant « prêt » (ai_check.py) : un doute → alerte, jamais validé automatiquement
        if result.get("ai_checked"):  # contrôle (et corrections) déjà faits pendant que le formulaire était ouvert
            if result.get("ai_alert"):
                result["detail"] = "; ".join(filter(None, [result["ai_alert"], result.get("detail", "")]))
        elif result["status"] == "ready" and ai_check.enabled():
            alert = ai_check.review(result.get("form_url") or "", result.get("filled") or {}, result.get("context"),
                                    result.get("screenshot_b64") or "")
            if alert:
                result["detail"] = "; ".join(filter(None, [alert, result.get("detail", "")]))

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
            # site mort pour de bon : noté dans l'annuaire commun (lm_finish_prepare), la fiche n'est plus proposée
            "site_dead": bool(result.get("site_dead")),
        }
        conn.execute("select public.lm_finish_prepare(%s, %s)", (attempt_id, Jsonb(finish)))
        if result.get("ai_fixes"):
            # corrections de l'IA gardées comme saisies à la main : l'envoi les rejoue à l'identique
            conn.execute("update public.lm_attempts set extra = coalesce(extra, '{}'::jsonb) || %s where id = %s",
                         (Jsonb(result["ai_fixes"]), attempt_id))
        log.info("%s → %s (%.1fs) %s", prospect["website"], result["status"], time.monotonic() - started,
                 (result.get("detail") or "")[:120])
        return {"status": result["status"], "found_email": result.get("found_email")}

    def find_emails(self, task: Task, conn: psycopg.Connection) -> dict[str, Any]:
        """Relève l'e-mail sur le site d'un prospect (sans formulaire, sans envoi)."""
        prospect_id = task.payload["prospect_id"]
        prospect = conn.execute("select name, website, found_email from public.lm_prospects where id = %s", (prospect_id,)).fetchone()
        if not prospect or not prospect["website"]:
            conn.execute("select public.lm_finish_emails(%s, %s)", (prospect_id, None))
            return {"skipped": "prospect sans site"}
        started = time.monotonic()
        if _social_host(prospect["website"]):
            result: dict | None = {"found_email": None, "detail": "réseau social ou annuaire"}
        else:
            job = {"mode": "emails", "site": prospect["website"], "name": prospect["name"], "locale": "fr-FR",
                   "headless": os.environ.get("HEADLESS", "true").lower() != "false"}
            result = run_site_job(job, int(os.environ.get("EMAILS_TIMEOUT", "90")))
        if result is None:
            result = {"found_email": None, "detail": "site bloqué : passé au suivant"}
        conn.execute("select public.lm_finish_emails(%s, %s)", (prospect_id, result.get("found_email")))
        log.info("EMAIL %s → %s (%.1fs) %s", prospect["website"], result.get("found_email") or "aucun",
                 time.monotonic() - started, (result.get("detail") or "")[:100])
        return {"found_email": result.get("found_email"), "emails": result.get("emails") or []}

    def on_final_failure(self, task: Task, conn: psycopg.Connection) -> None:
        if task.kind == "emails":
            conn.execute("select public.lm_finish_emails(%s, %s)", (task.payload["prospect_id"], None))
            return
        if task.kind == "send":
            # on ne sait pas si le message est parti : jamais de nouvel essai automatique
            conn.execute("select public.lm_finish_send(%s, %s)", (task.payload["attempt_id"], Jsonb(
                {"status": "to_verify", "submitted": False, "detail": "erreur du robot pendant l'envoi : vérifiez sur le site"})))
            return
        conn.execute("select public.lm_finish_prepare(%s, %s)",
                     (task.payload["attempt_id"], Jsonb({"status": "failed", "detail": "erreur répétée du worker"})))


__all__ = ["PrepareRunner"]
