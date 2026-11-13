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
  robot avec l'objet du message de l'agence ;
- des champs FACULTATIFS de rendez-vous ou de projet (date, heure, service, budget) laissés vides, quand le formulaire
  a une zone de message libre et que son texte invite aussi aux questions (« Have questions or ready to book? Fill
  out the form below ») : il sert aussi de formulaire de contact. Un champ est facultatif s'il n'a ni « * » ni
  « required » / « obligatoire » ; seul un tel champ OBLIGATOIRE bloque.
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
        elif k.startswith("saisi"):  # valeur saisie à la main ou corrigée par l'IA (sa vraie valeur est dans la liste des champs)
            out.append(f"- champ « {v[:80]} » ← valeur corrigée (voir sa valeur dans la liste des champs)")
        elif k == "consentement" or k.startswith("case"):
            out.append(f"- case cochée : « {v[:100]} »")
        else:
            out.append(f"- champ « {v[:80]} » ← {WHAT.get(k, k)}")
    return "\n".join(out) or "(rien)"


# Boucle de correction (12/11/2026, idée de Gabriel) : le contrôle se fait pendant que le formulaire est encore ouvert ;
# si un champ est mal rempli, l'IA dit lequel corriger et avec quoi, le robot corrige, l'IA revérifie (2 tours au plus).
FIX_RULES = """

CORRECTIONS. Tu reçois aussi la liste numérotée des champs du formulaire (n°, type, libellé, obligatoire, valeur
actuelle, choix possibles) et les données de l'agence. Si c'est bien un formulaire de contact mais qu'un champ est mal
rempli (valeur dans le mauvais champ, champ obligatoire vide, case obligatoire non cochée, choix de liste qui ferait
croire à un client alors qu'un choix neutre existe), mets send=false et donne les corrections dans « fixes » :
le n° du champ et la valeur EXACTE à y mettre. Valeurs permises, et rien d'autre :
- une des données de l'agence fournies (recopiée telle quelle) ou l'objet du message ;
- « oui » pour cocher une case ou un bouton ;
- pour une liste, exactement un des choix proposés pour ce champ.
N'invente jamais d'autre donnée (pas de budget, de date, de surface, de type de travaux). Si le formulaire n'est pas un
formulaire de contact (devis, rappel, inscription…), ou si rien ne peut être corrigé avec ces valeurs, « fixes » reste
vide. Si tout est bon, send=true et « fixes » vide."""


class Fix(BaseModel):
    field: int
    value: str


class FixVerdict(BaseModel):
    form_type: Literal["contact", "devis_ou_demande_client", "rappel", "newsletter_ou_inscription", "autre"]
    values_ok: bool
    list_choice_ok: bool
    send: bool
    reason: str
    fixes: list[Fix]


def passes(v) -> bool:
    return bool(v.send and v.form_type == "contact" and v.values_ok and v.list_choice_ok)


def review_fix(form_url: str, filled: dict, context: dict | None, screenshot_b64: str, fields: list[dict],
               agency: dict[str, str]) -> FixVerdict | None:
    """Contrôle avec corrections possibles. None si l'IA ne répond pas (le formulaire reste alors « à vérifier »)."""
    c = context or {}
    rows = []
    for f in fields:
        opts = (" | choix : " + " ; ".join(o[:40] for o in f.get("options", [])[:25])) if f.get("options") else ""
        rows.append(f"{f['i']} | {f['type'] or f['tag']} | « {f['key'][:80]} » | {'obligatoire' if f['required'] else 'facultatif'}"
                    f" | valeur : {(f.get('value') or '(vide)')[:80]}{opts}")
    data = "\n".join(f"- {k} : {v}" for k, v in agency.items() if v)
    text = (f"Adresse de la page : {form_url}\nTitre de la page : {c.get('title', '')}\n"
            f"Titres juste au-dessus du formulaire (les titres ailleurs dans la page sont ignorés) : {' | '.join(c.get('before') or []) or '(aucun)'}\n"
            f"Texte du formulaire (libellés, choix des listes) : {(c.get('form') or '(non disponible)')[:1500]}\n\n"
            f"Ce que le robot a rempli :\n{describe(filled)}\n\nChamps du formulaire (n° | type | libellé | obligatoire | "
            f"valeur actuelle | choix) :\n" + "\n".join(rows) + f"\n\nDonnées de l'agence :\n{data}\n\n"
            "La capture montre le formulaire rempli.")
    content: list = [{"type": "text", "text": text}]
    if screenshot_b64:
        content.insert(0, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": screenshot_b64}})
    try:
        r = _get_client().messages.parse(model=MODEL, max_tokens=1500, system=SYSTEM + FIX_RULES, output_format=FixVerdict,
                                         messages=[{"role": "user", "content": content}], timeout=25.0)
        v = r.parsed_output
    except Exception as exc:
        log.warning("contrôle IA indisponible pour %s : %s", form_url, str(exc)[:200])
        return None
    if v is not None:
        log.info("IA %s → %s (%s) %s ; corrections : %s", form_url, "ok" if passes(v) else "bloqué", v.form_type,
                 v.reason[:120], [(x.field, x.value[:30]) for x in v.fixes])
    return v


# IA de secours (13/11/2026) : le robot a trouvé une page avec des formulaires mais n'y voit pas de zone de message
# (mauvais formulaire choisi parmi plusieurs, message sur une seule ligne…). L'IA regarde la page et désigne le formulaire
# de contact général et la case où écrire le message, ou dit qu'il n'y en a pas.
RESCUE_SYSTEM = """Tu aides un robot qui envoie un message de prospection par le formulaire de contact du site d'une entreprise.
Sur cette page, le robot n'a pas trouvé de zone de message. Tu reçois la capture de la page et la liste numérotée de ses
champs visibles (n°, cadre, type, libellé, obligatoire). Dis s'il existe un formulaire de contact GÉNÉRAL (pas une lettre
d'info, pas un devis, pas une réservation, pas une candidature, pas une recherche, pas un compte client) et quelle case
reçoit le message libre (zone de texte, ou à défaut une case texte d'une ligne du type « Message », « Votre demande »,
« How can we help? »). Si tu as un doute, réponds contact=false : mieux vaut perdre un prospect qu'écrire au mauvais endroit."""


class Rescue(BaseModel):
    contact: bool
    message_field: int | None
    reason: str


def rescue(page_url: str, screenshot_b64: str, fields: list[dict]) -> Rescue | None:
    rows = [f"{f['k']} | cadre {f['frame']} | {f['type'] or f['tag']} | « {(f['label'] or '')[:80]} » | "
            f"{'obligatoire' if f['required'] else 'facultatif'}" for f in fields]
    content: list = [{"type": "text", "text": f"Adresse de la page : {page_url}\nChamps visibles (n° | cadre | type | libellé | obligatoire) :\n"
                      + "\n".join(rows)}]
    if screenshot_b64:
        content.insert(0, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": screenshot_b64}})
    try:
        r = _get_client().messages.parse(model=MODEL, max_tokens=600, system=RESCUE_SYSTEM, output_format=Rescue,
                                         messages=[{"role": "user", "content": content}], timeout=25.0)
        v = r.parsed_output
    except Exception as exc:
        log.warning("IA de secours indisponible pour %s : %s", page_url, str(exc)[:200])
        return None
    if v is not None:
        log.info("IA de secours %s → %s (case %s) %s", page_url, v.contact, v.message_field, v.reason[:120])
    return v


# Tri IA des devis (13/11/2026) : le robot écarte tout formulaire qui ressemble à un devis ; mesuré sur 30 devis tirés au
# hasard, environ 1 sur 8 est en réalité un formulaire de contact utilisable (titre « Contactez-nous », message libre,
# aucun champ obligatoire de projet). L'IA en juge ; le contrôle habituel (review_fix) repasse ensuite dessus.
DEVIS_SYSTEM = """Un robot envoie des messages de prospection honnêtes (une agence présente ses services) via le formulaire de
contact du site d'une entreprise. Il a écarté ce formulaire parce qu'il ressemble à un formulaire de DEVIS. Tu reçois la
capture du formulaire, le titre de la page, les titres au-dessus et le texte du formulaire. Dis s'il peut servir de
formulaire de contact SANS faire croire à une demande de client : zone de message libre présente ; AUCUN champ
OBLIGATOIRE qui demande un détail de projet de client (type de travaux, surface, budget, dimensions, adresse de chantier,
date, service souhaité, photos) ; titre du formulaire qui n'impose pas une demande de devis ou d'estimation (« Contactez-
nous », « Une question ? » vont ; « Demandez votre devis gratuit », « Get a free estimate » ne vont pas). Au moindre doute,
utilisable=false."""


class DevisVerdict(BaseModel):
    utilisable: bool
    champs_projet_obligatoires: list[str]
    raison: str


def devis_ok(form_url: str, context: dict | None, screenshot_b64: str) -> DevisVerdict | None:
    c = context or {}
    text = (f"Adresse de la page : {form_url}\nTitre de la page : {c.get('title', '')}\n"
            f"Titres juste au-dessus du formulaire : {' | '.join(c.get('before') or []) or '(aucun)'}\n"
            f"Texte du formulaire (libellés, choix des listes) : {(c.get('form') or '(non disponible)')[:2000]}")
    content: list = [{"type": "text", "text": text}]
    if screenshot_b64:
        content.insert(0, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": screenshot_b64}})
    try:
        r = _get_client().messages.parse(model=os.environ.get("AI_DEVIS_MODEL", MODEL), max_tokens=600, system=DEVIS_SYSTEM,
                                         output_format=DevisVerdict, messages=[{"role": "user", "content": content}],
                                         timeout=25.0)
        v = r.parsed_output
    except Exception as exc:
        log.warning("tri IA du devis indisponible pour %s : %s", form_url, str(exc)[:200])
        return None
    if v is not None:
        log.info("tri devis %s → %s %s", form_url, v.utilisable, v.raison[:120])
    return v


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
            f"Titres juste au-dessus du formulaire (les titres ailleurs dans la page sont ignorés) : {' | '.join(c.get('before') or []) or '(aucun)'}\n"
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
