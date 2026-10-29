"""Accueil (version US) : réglages Google Sheet, mot de passe, et accès au scan automatique."""
from __future__ import annotations

import json
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).parent
SETTINGS = ROOT / ".settings.json"
LINKS = ROOT / "LIENS.txt"

st.set_page_config(page_title="Scraper Google Maps US", page_icon="🇺🇸", layout="wide")
from auth import require_password, set_password  # noqa: E402
from sheets import service_account_email  # noqa: E402

require_password()


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS.read_text())
    except Exception:
        return {}


def save_settings(**kw):
    SETTINGS.write_text(json.dumps(load_settings() | kw, indent=2))


settings = load_settings()
st.title("🇺🇸 Scraper Google Maps — États-Unis")
st.markdown(
    "Deux outils :\n"
    "- **🤖 Scan automatique** (menu de gauche) : parcourt toutes les catégories Google dans toutes les villes des "
    "États-Unis et écrit les fiches retenues dans l'onglet **« Scan auto »** du Google Sheet.\n"
    "- **✉️ Bot de contact** : application séparée (son lien est dans `LIENS.txt` et ci-dessous). Il remplit les "
    "formulaires de contact des fiches dont la colonne **Opt-in** vaut « oui », en anglais.")
if LINKS.exists():
    st.info(LINKS.read_text())
    import re

    contact = re.search(r"Bot de contact\s*:\s*(https://\S+)", LINKS.read_text())
    st.link_button("✉️ Ouvrir le bot de contact", contact.group(1) if contact else "http://localhost:8601", type="primary")

st.subheader("📄 Google Sheet")
email = service_account_email(ROOT / settings.get("creds_path", "credentials.json"))
if email:
    st.caption(f"Le Sheet doit être partagé **en éditeur** avec : `{email}`")
else:
    st.error("Fichier credentials.json introuvable dans le dossier du projet.")
with st.form("sheet"):
    sheet_url = st.text_input("Lien du Google Sheet", value=settings.get("sheet_url", ""))
    if st.form_submit_button("Enregistrer", type="primary"):
        save_settings(sheet_url=sheet_url.strip())
        st.success("Enregistré : le scan et le bot de contact utilisent ce Sheet dès leur prochaine écriture.")

st.subheader("🔒 Mot de passe")
with st.form("pw"):
    a = st.text_input("Nouveau mot de passe", type="password")
    b = st.text_input("Confirmer", type="password")
    if st.form_submit_button("Changer le mot de passe"):
        if len(a) < 8:
            st.error("8 caractères minimum.")
        elif a != b:
            st.error("Les deux mots de passe ne correspondent pas.")
        else:
            set_password(a)
            st.success("Mot de passe changé (valable pour les deux interfaces).")
