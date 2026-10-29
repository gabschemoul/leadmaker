"""Envoi de fichiers dans Supabase Storage (rôle service, jamais exposé au navigateur)."""
from __future__ import annotations

import os

import httpx


def upload_png(path: str, data: bytes, bucket: str = "lm_screenshots") -> str:
    """Dépose une image et renvoie son chemin dans le bucket. SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis."""
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant")
    resp = httpx.post(
        f"{url}/storage/v1/object/{bucket}/{path}",
        content=data,
        headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "image/png", "x-upsert": "true"},
        timeout=30,
    )
    resp.raise_for_status()
    return path
