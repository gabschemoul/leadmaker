"""Export vers Google Sheets via un compte de service (voir README pour la configuration)."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import gspread
import pandas as pd


def service_account_email(creds_path: str | Path) -> str | None:
    try:
        return json.loads(Path(creds_path).read_text()).get("client_email")
    except Exception:
        return None


def export_dataframe(df: pd.DataFrame, creds_path: str | Path, sheet_url: str, tab_name: str) -> str:
    """Crée un nouvel onglet dans le Google Sheet et y écrit le tableau. Renvoie l'URL de l'onglet."""
    gc = gspread.service_account(filename=str(creds_path))
    sh = gc.open_by_url(sheet_url)

    title = f"{tab_name[:80]} {datetime.now():%Y-%m-%d %H%M}"
    ws = sh.add_worksheet(title=title, rows=max(len(df) + 1, 10), cols=max(len(df.columns), 5))
    values = [df.columns.tolist()] + df.astype(object).where(df.notna(), "").values.tolist()
    ws.update(values, "A1", value_input_option="RAW")  # RAW : sinon "+33 6..." est lu comme une formule
    ws.freeze(rows=1)
    ws.format("1:1", {"textFormat": {"bold": True}})
    return f"{sh.url}#gid={ws.id}"
