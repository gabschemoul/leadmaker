"""Page Streamlit : pilotage et suivi du scan automatique continu (crawler.py)."""
from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta

import pandas as pd
import streamlit as st

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from crawler import (  # noqa: E402
    DATA, LOG_PATH, PLACE_COLS, ROOT, TIERS, connect, get_config, get_state, is_running, set_state,
    workers_state, launch_detached,
    sync_sheets, tier_label,
)

st.set_page_config(page_title="Scan automatique", page_icon="🤖", layout="wide")
from auth import require_password  # noqa: E402

require_password()
db = connect()

st.title("🤖 Scan automatique")
st.caption("🇺🇸 Version États-Unis : enchaîne toutes les catégories Google dans toutes les villes des 50 États, sans s'arrêter. "
           "Les catégories qui rapportent le plus passent en premier ; une fiche déjà vue n'est jamais rouverte. "
           "Le scan tourne en arrière-plan : tu peux fermer cette page, il continue.")

# ---------------------------------------------------------------- Commandes
running = is_running(db)
control = get_state(db, "control", "run")

def save_visible():
    c = get_config(db)
    c["headless"] = not st.session_state.visible
    set_state(db, config=c)


c1, c2, c3, c4, _ = st.columns([1, 1, 1, 1.4, 1.6])
c4.toggle("👁️ Navigateur visible", value=not get_config(db)["headless"], key="visible", on_change=save_visible,
          help="Activé : une fenêtre Chrome s'ouvre par onglet de scan. Appliqué à la recherche suivante.")
if not running:
    if c1.button("▶️ Démarrer le scan", type="primary"):
        set_state(db, control="run")
        # Un processus par onglet, détaché du dashboard (le journal principal est scan.log).
        for i in range(int(get_config(db)["workers"])):
            launch_detached([sys.executable, "crawler.py", "--worker", str(i)], DATA / "scan.stdout.log")
        time.sleep(3)
        st.rerun()
else:
    if control == "pause":
        if c1.button("▶️ Reprendre", type="primary"):
            set_state(db, control="run")
            st.rerun()
    elif c1.button("⏸️ Pause"):
        set_state(db, control="pause")
        st.rerun()
    if c2.button("⏹️ Arrêter"):
        set_state(db, control="stop")
        st.rerun()
if get_state(db, "blocked_until", 0) and time.time() < get_state(db, "blocked_until", 0):
    if c3.button("🔓 Reprendre maintenant", help="Annule la pause anti-blocage (à faire après avoir changé d'IP)."):
        set_state(db, blocked_until=0)
        st.rerun()

# ---------------------------------------------------------------- Réglages
cfg = get_config(db)
with st.expander("⚙️ Réglages du scan (appliqués à la recherche suivante)", expanded=not running):
    with st.form("cfg"):
        r1, r2, r3, r4 = st.columns(4)
        note = r1.slider("Note Google", 0.0, 5.0, (float(cfg["rating_min"]), float(cfg["rating_max"])), 0.1)
        min_reviews = r2.number_input("Nombre d'avis minimum", 0, 10000, int(cfg["min_reviews"]))
        website = r3.radio("Site web", ["with", "without", "all"], index=["with", "without", "all"].index(cfg["website"]),
                           format_func={"with": "Avec site", "without": "Sans site", "all": "Tous"}.get, horizontal=True)
        target = r4.number_input("Objectif de fiches", 100, 10_000_000, int(cfg["target"]), 1000)
        s1, s2, s3, s4 = st.columns(4)
        delay = s1.slider("Délai entre fiches (s)", 0.5, 6.0, float(cfg["delay"]), 0.5)
        max_results = s2.slider("Max fiches par recherche", 20, 120, int(cfg["max_results"]), 10)
        sheets_every = s3.number_input("Envoi vers Sheets toutes les (min)", 1, 1440, int(cfg["sheets_every_min"]))
        stop_at_target = s4.checkbox("S'arrêter à l'objectif", value=cfg["stop_at_target"])
        x1, x2 = st.columns([1, 2])
        exclude_pb = x1.checkbox("Exclure administrations, banques et grandes chaînes", value=cfg["exclude_public_banks"],
                                 help="City/County/State government, DMV, police, courts, post offices, public schools, "
                                      "banks, credit unions, et les grandes enseignes (Walmart, McDonald's, Home Depot…). "
                                      "Un site web vu sur 5 fiches ou plus est aussi traité comme une chaîne.")
        extra = x2.text_input("Exclusions supplémentaires (mots-clés séparés par des virgules)",
                              value=cfg["extra_exclusions"], placeholder="ex. insurance, church")
        workers = st.slider("Onglets en parallèle", 1, 4, int(cfg["workers"]),
                            help="Plus d'onglets = plus rapide, mais Google bloque plus vite (même IP). "
                                 "Pris en compte au prochain démarrage.")
        if st.form_submit_button("Enregistrer"):
            set_state(db, config={
                "rating_min": note[0], "rating_max": note[1], "min_reviews": int(min_reviews), "website": website,
                "target": int(target), "stop_at_target": stop_at_target, "max_results": int(max_results),
                "delay": float(delay), "headless": get_config(db)["headless"], "sheets_every_min": int(sheets_every),
                "workers": int(workers),
                "exclude_public_banks": exclude_pb, "extra_exclusions": extra,
            })
            st.success("Réglages enregistrés.")
    st.caption("ℹ️ Les fiches déjà écartées ne sont pas réexaminées si tu changes les filtres après coup.")


# ---------------------------------------------------------------- Suivi en direct
@st.fragment(run_every=10)
def live():
    db = connect()
    cfg = get_config(db)
    q = lambda sql, *a: db.execute(sql, a).fetchone()[0]  # noqa: E731
    kept = q("select count(*) from places")
    seen = kept + q("select count(*) from seen")
    n_search = q("select count(*) from searches")
    since = (datetime.now() - timedelta(hours=24)).isoformat(timespec="seconds")
    kept_24h = q("select count(*) from places where scanned_at>=?", since)
    search_24h = q("select count(*) from searches where ts>=?", since)

    workers = workers_state(db)
    if workers:
        statuses = [w.get("status", "") for w in workers]
        status = "en cours" if "en cours" in statuses else statuses[0]
    else:
        status = get_state(db, "last_status") or "jamais lancé"
        if status not in ("terminé : toutes les vagues sont faites", "objectif atteint", "jamais lancé"):
            status = "arrêté"
    icon = {"en cours": "🟢", "en pause": "⏸️", "arrêté": "⚪", "jamais lancé": "⚪"}.get(status, "🟠")
    st.subheader(f"{icon} {status.capitalize()}" + (f" · {len(workers)} onglet(s)" if workers else ""))
    for w in workers:
        line = f"Onglet {w['id'] + 1} : {w.get('status', '')}"
        if w.get("current"):
            line += f" · **{w['current']}**"
        if w.get("last_place"):
            line += f" · dernière fiche retenue : {w['last_place']}"
        st.caption(line)
    if get_state(db, "last_error"):
        st.caption(f"⚠️ Dernier incident : {get_state(db, 'last_error')}")
    st.caption(f"📄 {get_state(db, 'sheets_status', 'Sheets : pas encore synchronisé')}")

    st.progress(min(kept / cfg["target"], 1.0), text=f"{kept:,} / {cfg['target']:,} fiches retenues".replace(",", " "))
    m = st.columns(5)
    m[0].metric("Fiches retenues", f"{kept:,}".replace(",", " "), f"+{kept_24h} en 24 h")
    m[1].metric("Fiches examinées", f"{seen:,}".replace(",", " "))
    m[2].metric("Recherches faites", f"{n_search:,}".replace(",", " "), f"+{search_24h} en 24 h")
    # Rythme sur les 24 dernières heures, ramené à la durée réellement écoulée si le scan est plus récent.
    first = db.execute("select min(ts) from searches where ts>=?", (since,)).fetchone()[0]
    hours = max((datetime.now() - datetime.fromisoformat(first)).total_seconds() / 3600, 0.25) if first else 0
    rate = kept_24h / hours if hours else 0
    m[3].metric("Rythme", f"{rate:.0f} fiches/h")
    remaining = cfg["target"] - kept
    m[4].metric("Objectif atteint dans", "—" if rate == 0 or remaining <= 0 else
                (f"{remaining / rate:.0f} h" if remaining / rate < 48 else f"{remaining / rate / 24:.0f} j"))

    tier = get_state(db, "tier", 0) or 0
    if tier < len(TIERS):
        done = q("select coalesce(sum(zone_idx), 0) from cursors where tier=?", tier)
        st.caption(f"{tier_label(tier)} · {done:,} recherches faites dans cette vague".replace(f"{done:,}", f"{done:,}".replace(",", " ")))

    hourly = pd.read_sql_query(
        "select substr(scanned_at, 1, 13) as heure, count(*) as fiches from places "
        "where scanned_at>=? group by heure order by heure", db,
        params=((datetime.now() - timedelta(hours=48)).isoformat(timespec="seconds"),))
    g1, g2 = st.columns([2, 1])
    with g1:
        st.markdown("**Fiches retenues par heure (48 h)**")
        if len(hourly):
            hourly["heure"] = pd.to_datetime(hourly["heure"])
            st.bar_chart(hourly, x="heure", y="fiches", height=220)
        else:
            st.caption("Pas encore de données.")
    with g2:
        st.markdown("**Catégories les plus rentables**")
        top = pd.read_sql_query("select categorie as Catégorie, kept as Retenues, searches as Recherches "
                                "from cat_stats order by kept desc limit 10", db)
        st.dataframe(top, hide_index=True, width="stretch", height=220)

    st.markdown("**Dernières fiches retenues**")
    last = pd.read_sql_query(f"select {', '.join(PLACE_COLS)}, scanned_at from places order by scanned_at desc limit 50", db)
    st.dataframe(last, hide_index=True, width="stretch",
                 column_config={"site_web": st.column_config.LinkColumn("Site web"),
                                "lien_maps": st.column_config.LinkColumn("Maps", display_text="Ouvrir"),
                                "note": st.column_config.NumberColumn("Note", format="%.1f ⭐")})


live()

# ---------------------------------------------------------------- Export & journal
st.divider()
e1, e2, _ = st.columns([1, 1, 3])
if e1.button("📤 Envoyer vers Sheets maintenant"):
    try:
        st.info(sync_sheets(db, __import__("logging").getLogger("scan")))
    except Exception as e:
        st.error(f"Erreur Sheets : {e}")
if e2.button("⬇️ Préparer le CSV complet"):
    all_rows = pd.read_sql_query(f"select {', '.join(PLACE_COLS)}, scanned_at from places order by scanned_at", db)
    st.download_button(f"Télécharger ({len(all_rows)} fiches)", all_rows.to_csv(index=False).encode("utf-8-sig"),
                       "scan_gmb.csv", "text/csv")

with st.expander("📜 Journal (50 dernières lignes)"):
    try:
        st.code("".join(LOG_PATH.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)[-50:]) or "—")
    except FileNotFoundError:
        st.caption("Pas encore de journal.")
