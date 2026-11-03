"""Surveillant des robots : prévient par e-mail quand la recherche ou les prises de contact n'avancent plus.

    python -m leadmaker_workers.watchdog            # boucle (toutes les WATCH_INTERVAL_SECONDS, 120 s)
    python -m leadmaker_workers.watchdog --once     # un seul contrôle, rapport à l'écran, alertes envoyées si dues
    python -m leadmaker_workers.watchdog --dry-run  # un seul contrôle, rien n'est envoyé ni mémorisé
    python -m leadmaker_workers.watchdog --test     # envoie un e-mail d'essai à ALERT_EMAIL

Ce que « n'avance plus » veut dire : il y a du travail à faire (des recherches ou des estimations en file dont
l'heure est venue, des formulaires à préparer, des messages validés à envoyer) et AUCUNE tâche de ce type ne
s'est terminée depuis WATCH_STALL_MINUTES (20 min). Les pauses normales ne déclenchent rien : campagne en pause
(ses tâches sont annulées), plafond quotidien de proxy atteint (les recherches attendent le lendemain), crédits
épuisés, limite d'envois du jour atteinte.

Portée (WATCH_SCOPE) : « search » = recherche Google Maps et estimations, « contact » = préparation des
formulaires, e-mails et envoi, « all » = les deux. Sur les serveurs, chacun surveille l'autre : le serveur
principal surveille les prises de contact (robots d'envoi), le serveur d'envoi surveille la recherche. Si un
serveur meurt entièrement, l'autre le signale.

E-mails (Resend, clé RESEND_API_KEY) : une alerte au début de la panne, un rappel toutes les WATCH_REMIND_HOURS
(2 h) tant que ça dure, un message « c'est reparti » à la reprise. Base injoignable pendant WATCH_DB_MINUTES
(10 min) → alerte aussi. L'état (panne déjà signalée ?) est gardé dans WATCH_STATE_FILE pour ne pas répéter.
"""
from __future__ import annotations

import argparse
import html
import json
import logging
import os
import socket
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import psycopg
from psycopg.rows import dict_row

log = logging.getLogger("leadmaker.watchdog")
PARIS = ZoneInfo("Europe/Paris")

SCOPES = {
    "search": {"kinds": ("discovery", "estimate"), "label": "la recherche", "title": "La recherche"},
    "contact": {"kinds": ("prepare", "emails", "send"), "label": "les prises de contact",
                "title": "Les prises de contact"},
}

# Couleurs des e-mails (thème Atlas, apps/web/styles/theme.css)
C = {"bg": "#f3f6f5", "card": "#ffffff", "border": "#dfe7e4", "text": "#1a2321", "muted": "#5f6f6c",
     "faint": "#8a9794", "primary": "#0f5a52", "brand": "#f2b531", "ink": "#0e2a27", "warn": "#b4531a",
     "ok": "#0f5a52"}


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def fmt_paris(dt: datetime | None) -> str:
    if dt is None:
        return "jamais"
    return dt.astimezone(PARIS).strftime("%d/%m à %H:%M")


def fmt_minutes(minutes: float) -> str:
    minutes = int(minutes)
    if minutes < 60:
        return f"{minutes} min"
    h, m = divmod(minutes, 60)
    return f"{h} h {m:02d}" if m else f"{h} h"


# ----------------------------------------------------------------------------------------------------- base


def connect() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL manquant")
    return psycopg.connect(url, row_factory=dict_row, autocommit=True, prepare_threshold=None, connect_timeout=15)


def _one(conn: psycopg.Connection, sql: str, params: tuple = ()) -> dict:
    row = conn.execute(sql, params).fetchone()
    return dict(row) if row else {}


def check_search(conn: psycopg.Connection) -> dict:
    """Recherches Google Maps et estimations : travail dû et dernière tâche terminée."""
    kinds = list(SCOPES["search"]["kinds"])
    pending = _one(conn, """
        select count(*) filter (where status = 'queued') as queued,
               count(*) filter (where status = 'running') as running,
               min(case when status = 'queued' then run_after else locked_at end) as due_since
          from public.lm_tasks
         where kind = any (%s::public.lm_task_kind[])
           and ((status = 'queued' and run_after <= now()) or status = 'running')
           and not (kind = 'discovery' and exists (
                 select 1 from public.lm_local_discovery_campaigns l
                  where l.campaign_id::text = payload ->> 'campaign_id'))""", (kinds,))
    # (les campagnes cherchées sur un ordinateur dédié ne comptent pas : elles attendent quand il est éteint)
    progress = _one(conn, """
        select max(updated_at) as last_progress
          from public.lm_tasks
         where kind = any (%s::public.lm_task_kind[]) and status in ('done', 'failed', 'cancelled')""", (kinds,))
    # Plafond quotidien de proxy atteint : le robot remet les recherches à demain avec ce message. Pause normale.
    budget = _one(conn, """
        select count(*) as n from public.lm_tasks
         where kind in ('discovery', 'estimate') and status = 'queued'
           and run_after > now() + interval '30 minutes' and error like 'plafond proxy%%'""")
    campaigns = conn.execute("""
        select c.name as campaign, a.name as team, count(*) as n
          from public.lm_tasks t
          join public.lm_campaigns c on c.id = (t.payload ->> 'campaign_id')::uuid
          join public.accounts a on a.id = c.account_id
         where t.kind = 'discovery' and ((t.status = 'queued' and t.run_after <= now()) or t.status = 'running')
           and not exists (select 1 from public.lm_local_discovery_campaigns l where l.campaign_id = c.id)
         group by 1, 2 order by 3 desc limit 6""").fetchall()
    return {
        "pending": int(pending.get("queued") or 0) + int(pending.get("running") or 0),
        "queued": int(pending.get("queued") or 0),
        "running": int(pending.get("running") or 0),
        "due_since": pending.get("due_since"),
        "last_progress": progress.get("last_progress"),
        "budget_paused": int(budget.get("n") or 0) > 0,
        "campaigns": [dict(r) for r in campaigns],
    }


def check_contact(conn: psycopg.Connection) -> dict:
    """Préparation des formulaires, e-mails, envois : travail dû et dernière tâche terminée.

    Les messages validés comptent seulement si le robot d'envoi les prendrait : solde de crédits de prise de
    contact > 0 et limite du jour de la campagne non atteinte (mêmes règles que lm_queue_sends ; plus de plafond
    par forfait depuis le 2/11/2026)."""
    kinds = list(SCOPES["contact"]["kinds"])
    pending = _one(conn, """
        select count(*) filter (where status = 'queued') as queued,
               count(*) filter (where status = 'running') as running,
               min(case when status = 'queued' then run_after else locked_at end) as due_since
          from public.lm_tasks
         where kind = any (%s::public.lm_task_kind[])
           and ((status = 'queued' and run_after <= now()) or status = 'running')""", (kinds,))
    validated = _one(conn, """
        with today as (
          select campaign_id, account_id from public.lm_attempts
           where status = 'sending' or (sent_at is not null and sent_at >= date_trunc('day', now()))
        )
        select count(*) as n, min(a.validated_at) as since
          from public.lm_attempts a
          join public.lm_campaigns c on c.id = a.campaign_id
          join public.lm_account_credits cr on cr.account_id = a.account_id
         where a.status = 'validated'
           and cr.outreach_balance > 0
           and (select count(*) from today s where s.campaign_id = a.campaign_id) < c.daily_limit
           and not exists (select 1 from public.lm_tasks t
                            where t.kind = 'send' and t.status in ('queued', 'running')
                              and t.payload ->> 'attempt_id' = a.id::text)""")
    progress = _one(conn, """
        select max(updated_at) as last_progress
          from public.lm_tasks
         where kind = any (%s::public.lm_task_kind[]) and status in ('done', 'failed', 'cancelled')""", (kinds,))
    campaigns = conn.execute("""
        select c.name as campaign, a.name as team, count(*) as n
          from public.lm_attempts at
          join public.lm_campaigns c on c.id = at.campaign_id
          join public.accounts a on a.id = at.account_id
         where at.status in ('validated', 'pending', 'preparing', 'sending')
         group by 1, 2 order by 3 desc limit 6""").fetchall()
    n_validated = int(validated.get("n") or 0)
    due_candidates = [d for d in (pending.get("due_since"), validated.get("since")) if d is not None]
    return {
        "pending": int(pending.get("queued") or 0) + int(pending.get("running") or 0) + n_validated,
        "queued": int(pending.get("queued") or 0),
        "running": int(pending.get("running") or 0),
        "validated": n_validated,
        "due_since": min(due_candidates) if due_candidates else None,
        "last_progress": progress.get("last_progress"),
        "budget_paused": False,
        "campaigns": [dict(r) for r in campaigns],
    }


def recent_errors(conn: psycopg.Connection, kinds: tuple[str, ...]) -> list[str]:
    rows = conn.execute("""
        select error, max(updated_at) as at, count(*) as n
          from public.lm_tasks
         where kind = any (%s::public.lm_task_kind[]) and error is not null and updated_at > now() - interval '3 hours'
         group by error order by max(updated_at) desc limit 4""", (list(kinds),)).fetchall()
    return [f"{r['n']} × {str(r['error'])[:160]} (dernier : {fmt_paris(r['at'])})" for r in rows]


def robots_seen(conn: psycopg.Connection, kinds: tuple[str, ...]) -> int:
    row = _one(conn, """
        select count(distinct worker_id) as n from public.lm_tasks
         where kind = any (%s::public.lm_task_kind[]) and worker_id is not null
           and updated_at > now() - interval '30 minutes'""", (list(kinds),))
    return int(row.get("n") or 0)


def evaluate(scope: str, info: dict, stall_minutes: float) -> dict:
    """Décide si la portée est bloquée : du travail est dû depuis au moins stall_minutes sans aucune tâche finie."""
    if info["pending"] == 0 or info["budget_paused"]:
        return {"stalled": False, "since": None, "minutes": 0.0}
    candidates = [d for d in (info.get("last_progress"), info.get("due_since")) if d is not None]
    since = max(candidates) if candidates else now_utc()
    minutes = (now_utc() - since).total_seconds() / 60
    return {"stalled": minutes >= stall_minutes, "since": since, "minutes": minutes}


# --------------------------------------------------------------------------------------------------- e-mail


def _mail(subject: str, title: str, lines: list[str], note: str | None, color: str) -> tuple[str, str]:
    items = "".join(
        f'<li style="margin:0 0 8px 0;font-size:15px;line-height:22px;color:{C["text"]}">{l}</li>' for l in lines)
    note_html = (f'<p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:{C["muted"]}">{note}</p>'
                 if note else "")
    body = f"""<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background-color:{C['bg']};font-family:'Figtree','Segoe UI',Helvetica,Arial,sans-serif;color:{C['text']}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{C['bg']}"><tr><td align="center" style="padding:32px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 20px 0;font-size:22px;line-height:28px;font-weight:800;letter-spacing:-0.5px;color:{C['ink']}">Prospectigo<span style="display:inline-block;width:7px;height:7px;margin-left:3px;border-radius:7px;background-color:{C['brand']}"></span></td></tr>
<tr><td style="padding:0 0 16px 0;font-size:22px;line-height:28px;font-weight:700;color:{color}">{title}</td></tr>
<tr><td style="background-color:{C['card']};border:1px solid {C['border']};border-radius:12px;padding:24px 28px">
<ul style="margin:0;padding:0 0 0 18px">{items}</ul>{note_html}
</td></tr>
<tr><td style="padding:16px 8px 0 8px;font-size:12px;line-height:20px;color:{C['faint']}">Surveillant des robots Prospectigo · {html.escape(server_name())}</td></tr>
</table></td></tr></table></body></html>"""
    return subject, body


def server_name() -> str:
    return os.environ.get("WATCH_SERVER") or socket.gethostname()


def send_email(subject: str, body: str, dry_run: bool = False) -> bool:
    to = os.environ.get("ALERT_EMAIL", "schemoul.gabriel@gmail.com")
    sender = os.environ.get("ALERT_FROM", "Prospectigo <noreply@prospectigo.com>")
    key = os.environ.get("RESEND_API_KEY", "").strip()
    if dry_run:
        log.info("(simulation) e-mail à %s : %s", to, subject)
        return True
    if not key:
        log.error("RESEND_API_KEY manquant : alerte NON envoyée (%s)", subject)
        return False
    r = httpx.post("https://api.resend.com/emails", timeout=20,
                   headers={"Authorization": f"Bearer {key}"},
                   json={"from": sender, "to": [to], "subject": subject, "html": body})
    if r.status_code >= 300:
        log.error("Resend a refusé l'e-mail (%s) : %s", r.status_code, r.text[:300])
        return False
    log.info("e-mail envoyé à %s : %s", to, subject)
    return True


def stalled_mail(scope: str, info: dict, verdict: dict, errors: list[str], robots: int, reminder: bool) -> tuple[str, str]:
    label = SCOPES[scope]["label"]
    title = SCOPES[scope]["title"]
    mins = fmt_minutes(verdict["minutes"])
    subject = f"⚠️ Prospectigo : {label} n’avance{'nt' if scope == 'contact' else ''} plus depuis {mins}"
    if reminder:
        subject = "Rappel · " + subject
    lines = [f"<strong>{title} n’avance{'nt' if scope == 'contact' else ''} plus depuis {mins}</strong> "
             f"(dernière tâche terminée : {fmt_paris(info.get('last_progress'))})."]
    if scope == "search":
        lines.append(f"En attente : {info['queued']} recherche(s) ou estimation(s) dont l’heure est venue, "
                     f"{info['running']} en cours (prise par un robot mais jamais terminée).")
    else:
        lines.append(f"En attente : {info['validated']} message(s) validé(s) à envoyer, {info['queued']} tâche(s) de "
                     f"préparation / e-mail / envoi en file, {info['running']} en cours.")
    if info.get("campaigns"):
        camps = ", ".join(f"{html.escape(c['campaign'])} ({html.escape(c['team'])}, {c['n']})" for c in info["campaigns"])
        lines.append(f"Campagnes concernées : {camps}.")
    lines.append(f"Robots vus dans les 30 dernières minutes : {robots}." if robots else
                 "Aucun robot n’a touché une tâche dans les 30 dernières minutes : les robots sont sans doute arrêtés.")
    if errors:
        lines.append("Dernières erreurs : " + " · ".join(html.escape(e) for e in errors))
    note = ("Que faire : regarder le serveur (docker compose ps, docker compose logs), ou revenir à la version "
            "précédente avec <code>./workers/scripts/deploy-robots.sh --rollback</code>"
            + (" (<code>--rollback-send</code> pour le serveur d’envoi)" if scope == "contact" else "")
            + ". Un nouveau message partira toutes les 2 h tant que ça dure, puis un « c’est reparti ».")
    return _mail(subject, title + " n’avance" + ("nt" if scope == "contact" else "") + " plus", lines, note, C["warn"])


def resumed_mail(scope: str, info: dict, downtime_minutes: float) -> tuple[str, str]:
    label = SCOPES[scope]["label"]; title = SCOPES[scope]["title"]
    verb = "ont repris" if scope == "contact" else "a repris"
    subject = f"✅ Prospectigo : {label} {verb}"
    lines = [f"<strong>{title} {verb}</strong> après {fmt_minutes(downtime_minutes)} d’arrêt.",
             f"Dernière tâche terminée : {fmt_paris(info.get('last_progress'))}.",
             f"Reste à faire : {info['pending']} tâche(s)."]
    return _mail(subject, title + " " + verb, lines, None, C["ok"])


def db_down_mail(error: str, minutes: float) -> tuple[str, str]:
    subject = f"🚨 Prospectigo : la base de données ne répond plus ({server_name()})"
    lines = [f"<strong>Impossible de lire la base de données depuis {fmt_minutes(minutes)}</strong> depuis {html.escape(server_name())}.",
             f"Dernière erreur : {html.escape(error[:300])}",
             "Les robots ne peuvent plus travailler tant que ça dure. Vérifier le projet Supabase (état, connexions)."]
    return _mail(subject, "Base de données injoignable", lines, None, C["warn"])


def db_back_mail(minutes: float) -> tuple[str, str]:
    subject = f"✅ Prospectigo : la base de données répond de nouveau ({server_name()})"
    lines = [f"<strong>La base de données répond de nouveau</strong> après {fmt_minutes(minutes)} d’interruption."]
    return _mail(subject, "Base de données de retour", lines, None, C["ok"])


# ----------------------------------------------------------------------------------------------------- état


def state_path() -> Path:
    return Path(os.environ.get("WATCH_STATE_FILE", "/app/state/watchdog.json"))


def load_state() -> dict:
    try:
        return json.loads(state_path().read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    try:
        state_path().parent.mkdir(parents=True, exist_ok=True)
        state_path().write_text(json.dumps(state, indent=1))
    except OSError:
        log.exception("état du surveillant non enregistré")


def _ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


# ----------------------------------------------------------------------------------------------- contrôle


def run_check(scopes: list[str], state: dict, dry_run: bool = False, report: bool = False) -> dict:
    stall_minutes = env_float("WATCH_STALL_MINUTES", 20)
    remind_hours = env_float("WATCH_REMIND_HOURS", 2)
    db_minutes = env_float("WATCH_DB_MINUTES", 10)
    now = now_utc()
    db_state = state.setdefault("db", {})

    try:
        conn = connect()
        results = {}
        for scope in scopes:
            info = check_search(conn) if scope == "search" else check_contact(conn)
            verdict = evaluate(scope, info, stall_minutes)
            results[scope] = (info, verdict)
        extra = {}
        for scope, (info, verdict) in results.items():
            if verdict["stalled"]:
                extra[scope] = (recent_errors(conn, SCOPES[scope]["kinds"]), robots_seen(conn, SCOPES[scope]["kinds"]))
        conn.close()
    except Exception as exc:  # base injoignable
        first = _ts(db_state.get("failing_since")) or now
        db_state["failing_since"] = first.isoformat()
        minutes = (now - first).total_seconds() / 60
        log.warning("base injoignable depuis %s : %s", fmt_minutes(minutes), exc)
        if minutes >= db_minutes:
            last = _ts(db_state.get("alerted_at"))
            if last is None or now - last >= timedelta(hours=remind_hours):
                subject, body = db_down_mail(str(exc), minutes)
                if send_email(subject, body, dry_run) and not dry_run:
                    db_state["alerted_at"] = now.isoformat()
        if not dry_run:
            save_state(state)
        return {"db": "down"}

    # Base de retour après une panne signalée
    if db_state.get("alerted_at"):
        minutes = (now - (_ts(db_state.get("failing_since")) or now)).total_seconds() / 60
        subject, body = db_back_mail(minutes)
        send_email(subject, body, dry_run)
    if db_state:
        state["db"] = {}

    summary = {}
    for scope, (info, verdict) in results.items():
        st = state.setdefault(scope, {})
        was = bool(st.get("stalled"))
        if verdict["stalled"]:
            errors, robots = extra[scope]
            alerted = _ts(st.get("alerted_at"))
            due = alerted is None or now - alerted >= timedelta(hours=remind_hours)
            if not was or due:
                subject, body = stalled_mail(scope, info, verdict, errors, robots, reminder=was)
                if send_email(subject, body, dry_run) and not dry_run:
                    st["alerted_at"] = now.isoformat()
            st["stalled"] = True
            st.setdefault("since", verdict["since"].isoformat())
        else:
            if was and st.get("alerted_at"):
                since = _ts(st.get("since")) or now
                subject, body = resumed_mail(scope, info, (now - since).total_seconds() / 60)
                send_email(subject, body, dry_run)
            state[scope] = {}
        summary[scope] = {"pending": info["pending"], "stalled": verdict["stalled"], "minutes": round(verdict["minutes"]),
                          "last_progress": fmt_paris(info.get("last_progress")), "budget_paused": info["budget_paused"]}
        if report:
            label = SCOPES[scope]["title"]
            if info["pending"] == 0:
                print(f"{label} : rien à faire (dernière tâche terminée {fmt_paris(info.get('last_progress'))}).")
            elif info["budget_paused"]:
                print(f"{label} : plafond de proxy du jour atteint, recherches reportées à demain (normal).")
            elif verdict["stalled"]:
                print(f"{label} : BLOQUÉE depuis {fmt_minutes(verdict['minutes'])}, {info['pending']} tâche(s) en attente.")
            else:
                print(f"{label} : avance ({info['pending']} tâche(s) en attente, dernière terminée "
                      f"{fmt_paris(info.get('last_progress'))}, sans progrès depuis {fmt_minutes(verdict['minutes'])}).")
    if not dry_run:
        save_state(state)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--once", action="store_true", help="un seul contrôle")
    parser.add_argument("--dry-run", action="store_true", help="un seul contrôle, rien d'envoyé ni mémorisé")
    parser.add_argument("--test", action="store_true", help="envoie un e-mail d'essai")
    parser.add_argument("--scope", default=os.environ.get("WATCH_SCOPE", "all"), help="search, contact ou all")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    scopes = list(SCOPES) if args.scope == "all" else [s.strip() for s in args.scope.split(",") if s.strip() in SCOPES]
    if not scopes:
        print("WATCH_SCOPE doit valoir search, contact ou all"); sys.exit(2)

    if args.test:
        subject, body = _mail("Prospectigo : e-mail d’essai du surveillant des robots", "E-mail d’essai",
                              [f"Le surveillant tourne sur <strong>{html.escape(server_name())}</strong> et surveille : "
                               + ", ".join(SCOPES[s]["label"] for s in scopes) + ".",
                               "Si vous lisez ceci, les alertes arriveront bien à cette adresse."], None, C["ok"])
        sys.exit(0 if send_email(subject, body) else 1)

    if args.once or args.dry_run:
        state = {} if args.dry_run else load_state()
        run_check(scopes, state, dry_run=args.dry_run, report=True)
        return

    interval = env_float("WATCH_INTERVAL_SECONDS", 120)
    log.info("surveillant démarré sur %s : %s (toutes les %d s)", server_name(), ", ".join(scopes), interval)
    state = load_state()
    while True:
        try:
            run_check(scopes, state)
        except Exception:
            log.exception("contrôle impossible")
        time.sleep(interval)


if __name__ == "__main__":
    main()
