"""Contrôle IA d'un formulaire « prêt », juste avant qu'il le devienne (7/11/2026).

Claude Haiku lit la capture du formulaire rempli, le titre de la page, les titres au-dessus du formulaire et ses
libellés. S'il y voit un devis, un rendez-vous, un rappel, une valeur mal placée ou un choix de liste qui ferait
croire à un client, le formulaire reste « prêt » mais avec une alerte (detail) : jamais validé automatiquement,
il attend une relecture. Coût ≈ 0,04 centime par formulaire.

Sans clé ANTHROPIC_API_KEY (ou AI_CHECK=off), rien ne change. Si l'IA ne répond pas, l'alerte le dit : un
formulaire non contrôlé ne part jamais tout seul.
"""
from __future__ import annotations

import logging
import os
from typing import Literal

from pydantic import BaseModel

log = logging.getLogger(__name__)

MODEL = os.environ.get("AI_CHECK_MODEL", "claude-haiku-5-5")
BLOCKED = "à vérifier — contrôle IA : "
UNAVAILABLE = "à vérifier — contrôle IA indisponible, formulaire non contrôlé"

SYSTEM = """Tu contrôles un robot qui envoie des messages de PROSPECTION commerciale (une agence propose ses services à
une entreprise) via le formulaire de contact du site de cette entreprise. Le robot vient de remplir un formulaire,
rien n'est encore envoyé. Tu dois dire s'il peut l'envoyer.

Règle absolue : le robot ne remplit QUE des formulaires de contact généraux. Il ne doit JAMAIS envoyer :
- un formulaire de devis, d'estimation, de chiffrage, de demande d'intervention ou de dépannage, de réservation, de
  rendez-vous, de commande, de demande de rappel (« Nous vous rappelons »), d'inscription, de candidature, de SAV ou
  de réclamation ;
- un formulaire dont le titre mélange contact et devis (« Devis / Contact », « Contact - Demande de devis »,
  « Une question, un devis ? ») ;
- un formulaire dont un champ OBLIGATOIRE demande un détail de projet de client (type de travaux, surface, budget,
  dimensions, adresse du chantier, date de l'événement, service souhaité, photos de l'objet) : l'entreprise
  croirait à un client ;
- un formulaire dont le titre parle de devis ou d'estimation (« Devis cuisine sur mesure », « Demander un devis
  gratuit », « Get a quote », « Free estimate ») ou d'intervention urgente (« Intervention urgence ») ;
- hors de la page contact du site : un formulaire dont le titre parle d'un projet ou d'un besoin de client (« Un
  projet ? Parlons-en », « Besoin d'un couvreur ? ») ;
- un formulaire d'avis, de commentaire de blog ou d'inscription à une lettre d'information.
Le robot ne doit pas non plus envoyer si une valeur est dans le mauvais champ (un nom dans « Dimensions », un
téléphone dans « Nom »…), si un champ obligatoire visible reste vide, ou si un choix de liste ou un bouton coché
ferait croire à un client (devis, tarif, particulier, rendez-vous, installation, commande…).

Ce qui est NORMAL dans un formulaire de contact (ne bloque pas pour ça) :
- un champ code postal, ville, société ou objet : le robot y met les coordonnées de l'agence ;
- une zone de message appelée « Votre demande », « Commentaire » ou « Comment pouvons-nous vous aider ? » ;
- un choix de liste neutre : information, renseignement, question, demande générale, contact, autre,
  partenariat, professionnel ; une liste facultative laissée sur « Sélectionnez » ;
- une phrase générale sous le titre (« N'hésitez pas à nous contacter ») ou un bouton « Devis » ailleurs dans le
  menu du site, tant que CE formulaire est un formulaire de contact ;
- sur la page contact du site (adresse avec « contact »), un titre accrocheur qui parle du projet du visiteur
  (« Let's talk about your project », « Get a Free Consultation », « Ready to Shape Your Space? », « Un projet ?
  Parlons-en ») quand le formulaire a une vraie zone de message libre où part le message : le message dit tout de
  suite qui écrit. Dans ce cas seuls les champs comptent (règle des champs obligatoires ci-dessus) ;
- une case « Project », « Votre projet » ou « Request » facultative laissée vide, ou obligatoire remplie par le
  robot avec l'objet du message de l'agence.
Ne juge pas le contenu du message ni les coordonnées écrites (texte de prospection déjà validé, parfois un texte de
test) ni les captchas (gérés à part).
La liste « Ce que le robot a rempli » est fiable : si la capture ne montre pas un champ (bandeau de cookies par-dessus,
capture coupée), fais confiance à la liste et ne bloque pas pour ça. Bloque seulement sur ce que tu vois ou lis. Si un formulaire de devis ou une valeur mal placée est probable, réponds send=false : il vaut
mieux perdre un prospect que faire croire à une demande de client. Écris la raison en une phrase courte, en français."""


class Verdict(BaseModel):
    form_type: Literal["contact", "devis_ou_demande_client", "rappel", "newsletter_ou_inscription", "autre"]
    values_ok: bool
    list_choice_ok: bool
    send: bool
    reason: str


# ce que le robot écrit dans chaque sorte de champ (sans les vraies coordonnées : inutile pour juger)
WHAT = {"full_name": "nom complet de l'agence", "first_name": "prénom", "last_name": "nom", "email": "e-mail",
        "phone": "téléphone", "company": "nom de l'agence", "city": "ville de l'agence", "zip": "code postal de l'agence",
        "subject": "objet du message", "website": "site de l'agence", "message": "message de prospection",
        "job_title": "fonction", "project": "objet du message de l'agence (case de projet obligatoire)", "address": "adresse de l'agence", "civility": "civilité", "country": "pays"}


def describe(filled: dict) -> str:
    out = []
    for k, v in (filled or {}).items():
        v = str(v)
        if " = " in v and k.startswith(("liste", "radio", "choix")):
            lab, ch = v.split(" = ", 1)
            out.append(f"- liste ou bouton « {lab[:80]} » : choix « {ch[:60]} »")
        elif k == "consentement" or k.startswith("case"):
            out.append(f"- case cochée : « {v[:100]} »")
        else:
            out.append(f"- champ « {v[:80]} » ← {WHAT.get(k, k)}")
    return "\n".join(out) or "(rien)"


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY")) and os.environ.get("AI_CHECK", "on").lower() != "off"


_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic(timeout=45.0, max_retries=2)
    return _client


def review(form_url: str, filled: dict, context: dict | None, screenshot_b64: str) -> str | None:
    """None si le formulaire peut partir ; sinon l'alerte à écrire dans detail."""
    if not enabled():
        return None
    c = context or {}
    text = (f"Adresse de la page : {form_url}\nTitre de la page : {c.get('title', '')}\n"
            f"Derniers titres au-dessus du formulaire : {' | '.join(c.get('before') or []) or '(aucun)'}\n"
            f"Texte du formulaire (libellés, choix des listes) : {(c.get('form') or '(non disponible)')[:1500]}\n\n"
            f"Ce que le robot a rempli :\n{describe(filled)}\n\nLa capture montre le formulaire rempli.")
    content: list = [{"type": "text", "text": text}]
    if screenshot_b64:
        content.insert(0, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": screenshot_b64}})
    try:
        r = _get_client().messages.parse(model=MODEL, max_tokens=1500, system=SYSTEM, output_format=Verdict,
                                         messages=[{"role": "user", "content": content}])
        v = r.parsed_output
    except Exception as exc:  # réseau, quota, réponse illisible : jamais d'envoi automatique sans contrôle
        log.warning("contrôle IA indisponible pour %s : %s", form_url, str(exc)[:200])
        return UNAVAILABLE
    if v is None:
        return UNAVAILABLE
    log.info("IA %s → %s (%s) %s", form_url, "ok" if v.send else "bloqué", v.form_type, v.reason[:120])
    if v.send and v.form_type == "contact" and v.values_ok and v.list_choice_ok:
        return None
    return BLOCKED + (v.reason.strip() or v.form_type)[:300]
