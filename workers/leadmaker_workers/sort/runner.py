"""Tri IA d'une entreprise pour une campagne (9/11/2026, CDC-PARCOURS-TRI-ANNUAIRE §4, étape 3).

Tâche « sort » : {campaign_id, prospect_id, version}. Le robot
1. lit la page d'accueil du site, sans proxy (environ 6 000 caractères de texte), ou reprend le texte déjà lu
   pour un autre client dans l'annuaire (lm_places, moins de 90 jours) ; réseaux sociaux non lus ;
2. demande à Claude Haiku un avis selon la cible en mots de la campagne et l'offre de l'équipe :
   gardee | a_verifier | ecartee, un groupe et une raison courte (montrée au client, dans la langue de la cible) ;
3. l'enregistre avec lm_finish_sort (ignoré si la cible a changé entre-temps).

Site injoignable → « a_verifier » sans appeler l'IA (CDC §4.1). « ecartee » reste interne : jamais montrée au
client, jamais payée. Coût mesuré au test du 9/11 : environ 0,35 $ pour 1 000 fiches.
Sans ANTHROPIC_API_KEY, ou avec SORT=off, la tâche échoue (et sera réessayée) : rien n'est trié au hasard.
"""
from __future__ import annotations

import html
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import httpx
import psycopg
from pydantic import BaseModel

from ..outreach.netguard import url_allowed
from ..outreach.runner import NO_FORM_HOSTS
from ..queue import Task

log = logging.getLogger("leadmaker.sort")

MODEL = os.environ.get("SORT_MODEL", "claude-haiku-5-5")
# Effort « medium » : mesuré le 9/11 sur 40 fiches vérifiées, « low » écartait 7 à 9 bonnes cibles sur 12 (cibles
# avec une négation mal lue), « medium » 4 ; coût ≈ 0,35 $ pour 1 000 fiches au lieu de 0,27 $.
SITE_MAX_AGE = timedelta(days=90)  # texte du site repris de l'annuaire en dessous de cet âge
TEXT_CHARS = 6000
MAX_BYTES = 600_000
MAX_REDIRECTS = 5
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/141.0.0.0 Safari/537.36")

SYSTEM = """Tu tries des entreprises pour un client de Prospectigo. Ce client veut les contacter pour leur proposer son offre.
On te donne : la cible que le client a décrite en mots, son offre, éventuellement les groupes de sa campagne, puis
la fiche d'une entreprise (nom, activité déclarée, ville, site, nombre d'avis) et le texte de sa page d'accueil
quand on a pu le lire.

verdict :
- "gardee" : l'entreprise correspond à la cible décrite.
- "ecartee" : elle ne correspond clairement pas à la cible (autre métier, autre type d'entreprise), ou elle ne
  respecte pas une précision explicite de la cible.
- "a_verifier" : impossible de trancher (texte du site absent, trop vague, ou indices vraiment contradictoires).

Comment juger :
- La cible du client fait foi. L'offre sert seulement à comprendre ce que le client cherche : n'écarte pas une
  entreprise de la cible en supposant qu'elle n'aurait pas besoin de l'offre, c'est au client d'en juger.
- Juge sur le cœur de métier : un service cité parmi d'autres sur le site (« sites web », « vidéo »…) ne fait
  pas le métier principal.
- Lis la cible avec bon sens : « agences de communication » comprend les agences de relations presse, de
  communication digitale, les studios ; les indépendants comptent comme des agences, sauf si la cible les exclut.
- Respecte chaque précision explicite de la cible (« sans celles qui font du web », « 2 personnes ou plus »…).
- Lis les négations de la cible avec soin : « pour qui le web n'est pas le cœur de métier » veut dire qu'on GARDE
  celles qui ne font pas de web, ou seulement en complément, et qu'on écarte celles dont le web est le métier
  principal.
- Ne te fie pas trop à l'activité déclarée : elle est souvent fausse. Le texte du site prime.

groupe : la clé du groupe de la campagne qui lui correspond le mieux, ou "autre" (toujours "autre" s'il n'y a pas
de groupes).
raison : une phrase courte et concrète (au plus 12 mots), écrite dans la langue de la cible du client, sans jargon,
qui dit ce qui t'a fait trancher (exemple : « Agence de communication, ne fait pas de sites »)."""


class SortVerdict(BaseModel):
    verdict: Literal["gardee", "a_verifier", "ecartee"]
    groupe: str
    raison: str


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY")) and os.environ.get("SORT", "on").lower() != "off"


def social_host(url: str) -> bool:
    host = (urlparse(url if "://" in url else f"http://{url}").hostname or "").lower().removeprefix("www.")
    return any(host == h or host.endswith("." + h) for h in NO_FORM_HOSTS)


def page_text(raw: str) -> str:
    """Titre, description et texte visible d'une page HTML (au plus TEXT_CHARS caractères de texte)."""
    raw = raw.replace("\x00", "")  # caractère nul : refusé par Postgres (vu en ligne le 9/11 sur un site)
    title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    desc = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', raw, re.I)
    body = re.sub(r"<(script|style|noscript|svg|template)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    body = html.unescape(re.sub(r"<[^>]+>", " ", body))
    body = re.sub(r"\s+", " ", body).strip()
    parts = [f"Titre : {html.unescape(title.group(1)).strip()}" if title else "",
             f"Description : {html.unescape(desc.group(1)).strip()}" if desc else "",
             body[:TEXT_CHARS]]
    return "\n".join(p for p in parts if p)


def fetch_site(url: str) -> tuple[str, str]:
    """(état, texte) de la page d'accueil : « ok », « unreachable » ou « social ».

    Garde réseau à chaque étape (redirections comprises) : jamais d'adresse interne, seulement des sites publics."""
    if social_host(url):
        return "social", ""
    try:
        with httpx.Client(headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"},
                          timeout=15, follow_redirects=False) as client:
            for _ in range(MAX_REDIRECTS + 1):
                if not url_allowed(url):
                    return "unreachable", ""
                with client.stream("GET", url) as r:
                    if r.is_redirect and r.headers.get("location"):
                        url = urljoin(url, r.headers["location"])
                        if social_host(url):
                            return "social", ""
                        continue
                    if r.status_code >= 400:
                        return "unreachable", ""
                    chunks, size = [], 0
                    for chunk in r.iter_bytes():
                        chunks.append(chunk)
                        size += len(chunk)
                        if size >= MAX_BYTES:
                            break
                    raw = b"".join(chunks).decode(r.encoding or "utf-8", errors="replace")
                    text = page_text(raw)
                    return ("ok", text) if len(text) > 80 else ("unreachable", "")
            return "unreachable", ""
    except Exception as exc:  # site mort, certificat, délai : « à vérifier », jamais une erreur de tâche
        log.info("site illisible %s : %s", url, type(exc).__name__)
        return "unreachable", ""


_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic(timeout=60.0, max_retries=3)
    return _client


def ask(target: str, offer: str | None, groups: list[dict], fiche: str, site: str) -> tuple[SortVerdict | None, dict]:
    group_lines = "\n".join(f"- {g.get('key')} : {g.get('label')}" for g in groups if g.get("key")) or "(aucun)"
    content = (f"Cible du client : {target}\nOffre du client : {offer or '(non précisée)'}\n"
               f"Groupes de la campagne :\n{group_lines}\n\n--- Entreprise ---\n{fiche}\n{site}")
    r = _get_client().messages.parse(model=MODEL, max_tokens=1500, system=SYSTEM, output_format=SortVerdict,
                                     output_config={"effort": os.environ.get("SORT_EFFORT", "medium")},
                                     messages=[{"role": "user", "content": content}])
    usage = {"tokens_in": r.usage.input_tokens, "tokens_out": r.usage.output_tokens}
    if r.stop_reason == "refusal":
        return None, usage
    return r.parsed_output, usage


class SortRunner:
    def run(self, task: Task, conn: psycopg.Connection) -> dict[str, Any]:
        p = task.payload
        ctx = conn.execute(
            """select c.sort_target, c.sort_groups, c.sort_version, s.offer,
                      pr.name, pr.category, pr.city, pr.website, pr.review_count, pr.google_place_id,
                      pl.site_status, pl.site_text, pl.site_read_at
                 from public.lm_campaigns c
                 join public.lm_spaces s on s.id = c.space_id
                 join public.lm_campaign_prospects cp on cp.campaign_id = c.id and cp.prospect_id = %s
                 join public.lm_prospects pr on pr.id = cp.prospect_id
                 left join public.lm_places pl on pl.google_place_id = pr.google_place_id
                where c.id = %s""",
            (p["prospect_id"], p["campaign_id"]),
        ).fetchone()
        if not ctx or not ctx["sort_target"] or ctx["sort_version"] != int(p.get("version", -1)):
            return {"skipped": "cible changée ou entreprise retirée"}
        if not enabled():
            raise RuntimeError("tri IA désactivé (ANTHROPIC_API_KEY absente ou SORT=off)")

        # Texte du site : repris de l'annuaire s'il a moins de 90 jours, sinon lu maintenant
        fresh = ctx["site_read_at"] and ctx["site_read_at"] > datetime.now(timezone.utc) - SITE_MAX_AGE
        reused = bool(fresh and ctx["site_status"])
        if reused:
            status, text = ctx["site_status"], ctx["site_text"] or ""
        elif ctx["website"]:
            status, text = fetch_site(ctx["website"])
        else:
            status, text = None, ""

        def finish(verdict: str, group: str | None, reason: str) -> bool:
            return conn.execute(
                "select public.lm_finish_sort(%s, %s, %s, %s, %s, %s, %s, %s) as ok",
                (p["campaign_id"], p["prospect_id"], ctx["sort_version"], verdict, group, reason,
                 None if reused else status, None if reused else text),
            ).fetchone()["ok"]

        if status == "unreachable":
            saved = finish("a_verifier", "autre", "Site injoignable")
            return {"verdict": "a_verifier", "site": status, "reused": reused, "saved": saved}

        fiche = (f"Nom : {ctx['name']}\nActivité déclarée : {ctx['category'] or '?'}\nVille : {ctx['city'] or '?'}\n"
                 f"Site : {ctx['website'] or '(aucun)'}\nNombre d'avis : {ctx['review_count'] or 0}")
        if status == "ok":
            site = f"\nTexte de la page d'accueil :\n{text}"
        elif status == "social":
            site = "\n(Le site est une page de réseau social : non lu.)"
        else:
            site = "\n(Pas de site.)"
        groups = ctx["sort_groups"] if isinstance(ctx["sort_groups"], list) else []
        verdict, usage = ask(ctx["sort_target"], ctx["offer"], groups, fiche, site)
        if verdict is None:
            saved = finish("a_verifier", "autre", "Pas pu être triée automatiquement")
            return {"verdict": "a_verifier", "site": status, "reused": reused, "saved": saved, **usage}
        keys = {g.get("key") for g in groups}
        group = verdict.groupe if verdict.groupe in keys else "autre"
        saved = finish(verdict.verdict, group, verdict.raison.replace("\x00", "").strip())
        log.info("tri %s → %s (%s) %s", ctx["name"], verdict.verdict, status or "sans site", verdict.raison[:80])
        return {"verdict": verdict.verdict, "site": status, "reused": reused, "saved": saved, **usage}


__all__ = ["SortRunner", "fetch_site", "page_text"]
