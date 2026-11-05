"""Garde réseau des robots de prise de contact (audit du 5/11/2026, point C1).

Les sites visités viennent d'internet ou d'un fichier importé par un client : un client mal intentionné
pourrait y mettre une adresse interne (127.0.0.1, 169.254.169.254, 192.168.x.x, le réseau Docker, file://…)
ou une page dont le code va lire ces adresses, puis récupérer le résultat via la capture d'écran ou les
e-mails relevés. Ce module bloque, dans le navigateur, toute requête qui ne vise pas un site web PUBLIC :

- protocole autre que http(s) ;
- hôte qui est (ou dont le nom résout vers) une adresse privée, locale, de lien local, réservée…

La résolution DNS est mise en cache par hôte (un site charge ses ressources depuis quelques dizaines
d'hôtes au plus). Un nom qui ne résout pas est laissé passer : la requête échouera d'elle-même.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from functools import lru_cache
from urllib.parse import urlparse

ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_HOSTNAMES = {"localhost", "metadata", "metadata.google.internal"}


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


@lru_cache(maxsize=1024)
def host_is_public(host: str) -> bool:
    host = host.strip("[]").rstrip(".").lower()
    if not host or host in BLOCKED_HOSTNAMES or host.endswith((".localhost", ".internal", ".local")):
        return False
    try:
        return _ip_is_public(ipaddress.ip_address(host))
    except ValueError:
        pass  # c'est un nom, pas une adresse
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError, OSError):
        return True  # ne résout pas : rien à protéger, la requête échouera
    addresses = {info[4][0] for info in infos}
    try:
        return all(_ip_is_public(ipaddress.ip_address(a.split("%")[0])) for a in addresses)
    except ValueError:
        return False


# Tests en local uniquement (faux sites sur *.localhost) : NETGUARD_ALLOW_PRIVATE=1 laisse passer les adresses
# privées, jamais les autres protocoles. À ne JAMAIS poser sur les serveurs.
ALLOW_PRIVATE = os.environ.get("NETGUARD_ALLOW_PRIVATE") == "1"


def url_allowed(url: str) -> bool:
    """True si l'adresse vise un site web public (http/https, hôte public)."""
    try:
        parts = urlparse(url)
    except ValueError:
        return False
    if parts.scheme.lower() not in ALLOWED_SCHEMES or not parts.hostname:
        return False
    return ALLOW_PRIVATE or host_is_public(parts.hostname)


def install(ctx, blocked_types: tuple[str, ...] = ()) -> None:
    """Pose la garde sur un contexte Playwright (remplace un ctx.route("**/*") existant).

    blocked_types : types de ressources à ne pas charger du tout (polices, vidéos…), pour aller plus vite.
    """

    def _handler(route):
        request = route.request
        if request.resource_type in blocked_types or not url_allowed(request.url):
            route.abort("blockedbyclient")
        else:
            route.continue_()

    ctx.route("**/*", _handler)
