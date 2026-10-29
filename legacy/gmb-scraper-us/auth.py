"""Mot de passe des interfaces (indispensable : elles sont accessibles par un lien Internet).

Le mot de passe est stocké haché dans .settings.json (clé « password_hash ») et se change depuis la page d'accueil.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from pathlib import Path

import streamlit as st

SETTINGS = Path(__file__).parent / ".settings.json"


def _settings() -> dict:
    try:
        return json.loads(SETTINGS.read_text())
    except Exception:
        return {}


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    return f"{salt}${hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 200_000).hex()}"


def check_password(password: str, stored: str) -> bool:
    salt, _, _ = stored.partition("$")
    return hmac.compare_digest(hash_password(password, salt), stored)


def set_password(password: str):
    SETTINGS.write_text(json.dumps(_settings() | {"password_hash": hash_password(password)}, indent=2))


def require_password():
    """À appeler juste après st.set_page_config : arrête la page tant que le bon mot de passe n'est pas saisi."""
    stored = _settings().get("password_hash")
    if not stored or st.session_state.get("auth_ok"):
        return
    st.title("🔒 Accès protégé")
    with st.form("login"):
        pw = st.text_input("Mot de passe", type="password")
        ok = st.form_submit_button("Entrer", type="primary")
    if ok:
        if check_password(pw, stored):
            st.session_state.auth_ok = True
            st.rerun()
        st.error("Mot de passe incorrect.")
    st.stop()
