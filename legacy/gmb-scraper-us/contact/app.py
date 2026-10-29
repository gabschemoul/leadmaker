"""Page Streamlit : bot de contact. Prépare les formulaires des fiches opt-in, tu valides chaque envoi."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crawler import launch_detached  # noqa: E402
from contact_bot import (  # noqa: E402
    DATA, ROOT, VARIABLES, bot_alive, connect, ensure_columns, get_config, get_state, open_sheet, render, sent_today,
    set_state, template_problems, write_analytics, _hkey,
)

st.set_page_config(page_title="Bot de contact", page_icon="✉️", layout="wide")
from auth import require_password  # noqa: E402

require_password()
db = connect()
cfg = get_config(db)

st.title("✉️ Bot de contact")
st.caption("Le bot prépare les formulaires de contact des fiches dont la colonne **Opt-in** vaut « oui » dans le Sheet "
           "(onglet « Scan auto »). **Rien n'est envoyé sans ta validation** : tu vois chaque formulaire rempli, "
           "tu peux corriger le message, puis tu cliques sur Envoyer.")

# ---------------------------------------------------------------- Réglages
problems = {t["nom"]: template_problems(t, cfg["sender"]) for t in cfg["templates"]}
ready_templates = [t for t in cfg["templates"] if t["message"].strip() and not problems[t["nom"]]]
missing_sender = [k for k in ("prenom", "nom", "societe", "email") if not cfg["sender"].get(k)]

with st.expander(f"⚙️ Ton profil et tes {len(cfg['templates'])} modèles de message", expanded=not ready_templates or bool(missing_sender)):
    with st.form("cfg"):
        st.markdown("**Ton profil** (utilisé pour remplir les champs nom, email, téléphone, société…)")
        s = cfg["sender"]
        c = st.columns(3)
        sender = {
            "prenom": c[0].text_input("Prénom", s["prenom"]), "nom": c[1].text_input("Nom", s["nom"]),
            "societe": c[2].text_input("Société", s["societe"]), "email": c[0].text_input("Email", s["email"]),
            "telephone": c[1].text_input("Téléphone", s["telephone"]), "site": c[2].text_input("Ton site web", s["site"]),
            "adresse": c[0].text_input("Adresse (si demandée)", s["adresse"]),
            "code_postal": c[1].text_input("Code postal", s["code_postal"]), "ville": c[2].text_input("Ville", s["ville"]),
            "pays": c[0].text_input("Pays", s["pays"]),
        }
        st.markdown("**Modèles de message** (un modèle différent est utilisé à tour de rôle). Variables disponibles : "
                    + ", ".join(f"`{k}` ({v})" for k, v in VARIABLES.items()))
        st.caption("Chaque modèle doit contenir ta société (variable {societe} ou son nom).")
        templates = []
        for i, t in enumerate(cfg["templates"]):
            st.markdown(f"**Modèle {i + 1}**")
            a, b = st.columns([1, 3])
            nom = a.text_input("Nom du modèle", t["nom"], key=f"tn{i}")
            objet = a.text_input("Objet (si le formulaire en demande un)", t["objet"], key=f"to{i}")
            message = b.text_area("Message", t["message"], height=170, key=f"tm{i}")
            templates.append({"nom": nom.strip() or f"Modèle {i + 1}", "objet": objet, "message": message})
        k1, k2, k3 = st.columns(3)
        ahead = k1.number_input("Formulaires préparés à l'avance", 5, None, int(cfg["prepare_ahead"]),
                                help="Le bot prépare jusqu'à ce nombre de formulaires, puis attend ta validation.")
        workers = k2.number_input("Onglets en parallèle", 1, 8, int(cfg["workers"]),
                                  help="Nombre de sites préparés en même temps. Les envois validés partent un par un.")
        start_row = k3.number_input("Commencer à la ligne du Sheet", 2, 1_000_000, int(cfg["start_row"]))
        if st.form_submit_button("Enregistrer", type="primary"):
            names = [t["nom"] for t in templates]
            if len(set(names)) != len(names):
                st.error("Deux modèles ont le même nom.")
            else:
                set_state(db, config=get_config(db) | {"sender": sender, "templates": templates, "prepare_ahead": int(ahead),
                                                       "workers": int(workers), "start_row": int(start_row)})
                try:  # noms de modèles éventuellement changés : on réécrit l'onglet Analytics du Sheet
                    write_analytics(open_sheet(), [t["nom"] for t in templates if t["message"].strip()])
                except Exception as e:
                    st.warning(f"Onglet Analytics non mis à jour : {e}")
                st.success("Enregistré.")
                st.rerun()
    for t in cfg["templates"]:
        for p in problems[t["nom"]]:
            st.warning(f"**{t['nom']}** n'est pas utilisable : {p}.")
    if missing_sender:
        st.warning("Profil incomplet : " + ", ".join(missing_sender))

    # Aperçu d'un modèle avec une fiche fictive
    if ready_templates:
        ex = {"nom": "Garage Dupont", "ville": "Libourne", "categorie": "Garage automobile", "note": 2.8, "nb_avis": 14,
              "site": "https://garage-dupont.fr"}
        pick = st.selectbox("Aperçu", [t["nom"] for t in ready_templates])
        t = next(t for t in ready_templates if t["nom"] == pick)
        st.text(render(t["objet"], ex, cfg["sender"]) + "\n\n" + render(t["message"], ex, cfg["sender"]))

# ---------------------------------------------------------------- Commandes
alive = bot_alive(db)
ctl = get_state(db, "control", "run")


def save_limit():  # les callbacks tournent dans un autre thread : connexion dédiée
    d = connect()
    c = get_config(d)
    c["daily_limit"] = int(st.session_state.daily_limit)
    set_state(d, config=c)


def save_visible():
    d = connect()
    c = get_config(d)
    c["headless"] = not st.session_state.visible
    set_state(d, config=c)


b1, b2, b3, b4, _ = st.columns([1, 1, 1.4, 1.4, 1.2])
b4.toggle("👁️ Navigateur visible", value=not cfg["headless"], key="visible", on_change=save_visible,
          help="Activé : tu vois la fenêtre Chrome remplir les formulaires. Appliqué au formulaire suivant.")
b3.number_input("📮 Limite d'envois par jour", 1, None, int(cfg["daily_limit"]), 5000, key="daily_limit",
                on_change=save_limit, help="Modifiable à tout moment, appliqué immédiatement (même bot lancé).")
if not alive:
    if b1.button("▶️ Démarrer le bot", type="primary", disabled=not ready_templates or bool(missing_sender)):
        set_state(db, control="run")
        launch_detached([sys.executable, "contact_bot.py"], DATA / "contact.stdout.log")
        time.sleep(3)
        st.rerun()
else:
    if ctl == "pause":
        if b1.button("▶️ Reprendre", type="primary"):
            set_state(db, control="run")
            st.rerun()
    elif b1.button("⏸️ Pause"):
        set_state(db, control="pause")
        st.rerun()
    if b2.button("⏹️ Arrêter"):
        set_state(db, control="stop")
        st.rerun()


# ---------------------------------------------------------------- Suivi + validation
@st.fragment(run_every=15)
def status_bar():
    db = connect()
    cfg = get_config(db)
    n = dict(db.execute("select status, count(*) from contacts group by status").fetchall())
    alive = bot_alive(db)
    st.subheader(("🟢 " if alive else "⚪ ") + (get_state(db, "status", "jamais lancé") if alive else "Arrêté")
                 + (f" · {get_state(db, 'current')}" if alive and get_state(db, "current") else ""))
    m = st.columns(6)
    m[0].metric("Fiches opt-in « oui »", get_state(db, "optin_total", "—"))
    m[1].metric("À valider", n.get("à valider", 0))
    m[2].metric("Envoyés aujourd'hui", f"{sent_today(db)} / {cfg['daily_limit']}")
    m[3].metric("Envoyés au total", n.get("envoyé", 0))
    m[4].metric("À vérifier", n.get("à vérifier", 0), help="Envoyé, mais aucune confirmation visible : regarde la capture.")
    m[5].metric("Sans formulaire / captcha", n.get("pas de formulaire", 0) + n.get("captcha", 0))


status_bar()

n_fix = db.execute("select count(*) from contacts where status='à valider' and missing is not null").fetchone()[0]
n_check = db.execute("select count(*) from contacts where status='à vérifier'").fetchone()[0]
tab_bulk, tab_fix, tab_check, tab_val, tab_stats, tab_hist = st.tabs(
    ["📦 Envoi groupé", f"⚠️ À compléter ({n_fix})", f"🔎 À vérifier ({n_check})", "✅ À valider (un par un)",
     "📊 Analytics", "📜 Historique"])
with tab_bulk:
    size = st.number_input("Taille de la liste", 10, None, 1000, 50)
    bulk = pd.read_sql_query(
        "select site_key, nom as Entreprise, categorie as Catégorie, ville as Ville, template as Modèle, "
        "coalesce(detail, '') as Alerte, form_url as Formulaire from contacts where status='à valider' and missing is null "
        "order by (coalesce(detail, '') != ''), prepared_at limit ?", db, params=(int(size),))
    if bulk.empty:
        st.info("Aucun formulaire prêt pour le moment : le bot en prépare en arrière-plan.")
    else:
        bulk.insert(0, "Envoyer", bulk["Alerte"] == "")
        st.caption(f"**{len(bulk)} formulaires prêts** sur {int(size)} demandés (le bot continue d'en préparer). "
                   "Les formulaires avec un champ obligatoire vide sont dans l'onglet « ⚠️ À compléter ». "
                   "Ceux avec une autre alerte sont décochés par défaut, en bas de liste. "
                   "Décoche ceux que tu ne veux pas envoyer.")
        edited = st.data_editor(bulk, hide_index=True, width="stretch", height=480, disabled=list(bulk.columns[1:]),
                                column_config={"site_key": None, "Formulaire": st.column_config.LinkColumn()})
        keys = edited.loc[edited["Envoyer"], "site_key"].tolist()
        left = max(cfg["daily_limit"] - sent_today(db), 0)
        if len(keys) > left:
            st.warning(f"Limite du jour : {left} envoi(s) possible(s) aujourd'hui, le reste partira demain "
                       "(ou augmente la limite ci-dessus).")
        if st.button(f"📤 Envoyer les {len(keys)} formulaires sélectionnés", type="primary", disabled=not keys):
            db.executemany("update contacts set status='à envoyer' where site_key=? and status='à valider'", [(k,) for k in keys])
            st.success(f"{len(keys)} formulaires envoyés au bot : il les envoie sur {cfg['workers']} onglets en parallèle.")
            time.sleep(1)
            st.rerun()

with tab_fix:
    st.caption("Formulaires où un champ obligatoire n'a pas pu être rempli. Deux façons de faire :  \n"
               "• **🖥️ Ouvrir dans Chrome** : le formulaire s'ouvre déjà rempli, champs à problème encadrés en rouge. "
               "Tu corriges, tu cliques sur Envoyer sur le site, tu fermes la fenêtre, puis « ✔️ Je l'ai envoyé ».  \n"
               "• ou saisis la valeur ci-dessous puis « ✅ Compléter et envoyer » : le bot remplit et envoie.")
    fcols = [d[0] for d in db.execute("select * from contacts limit 0").description]
    to_fix = [dict(zip(fcols, r)) for r in db.execute(
        "select * from contacts where status='à valider' and missing is not null order by prepared_at limit 20")]
    if not to_fix:
        st.info("Rien à compléter pour le moment.")
    for row in to_fix:
        k = row["site_key"]
        with st.container(border=True):
            st.markdown(f"**{row['nom']}** · {row['categorie'] or ''} · {row['ville'] or ''} · "
                        f"[🔗 ouvrir le formulaire]({row['form_url'] or row['site']}) · [site]({row['site']}) · {row['template']}")
            if row["shot"] and Path(row["shot"]).exists():
                with st.expander("Voir le formulaire rempli par le bot"):
                    st.image(row["shot"])
            values = {lab: st.text_input(f"{lab}", key=f"x_{k}_{j}")
                      for j, lab in enumerate(json.loads(row["missing"]))}
            y0, y4, y1, y2, y3 = st.columns(5)
            if y0.button("🖥️ Ouvrir dans Chrome", key=f"xo_{k}"):
                launch_detached([sys.executable, "ouvrir_formulaire.py", k], DATA / "ouvrir_formulaire.log")
                st.toast("Chrome s'ouvre avec le formulaire rempli (quelques secondes)…")
            if y4.button("✔️ Je l'ai envoyé", key=f"xm_{k}"):
                db.execute("update contacts set status='envoyé', detail='envoyé à la main', sent_at=?, sheet_synced=0 "
                           "where site_key=?", (time.strftime("%Y-%m-%dT%H:%M:%S"), k))
                st.rerun()
            if y1.button("✅ Compléter et envoyer", key=f"xs_{k}", type="primary",
                         disabled=not all(v.strip() for v in values.values())):
                db.execute("update contacts set status='à envoyer', extra=? where site_key=?",
                           (json.dumps(values, ensure_ascii=False), k))
                st.rerun()
            if y2.button("⏭️ Passer", key=f"xp_{k}"):
                db.execute("update contacts set status='passé', sheet_synced=0 where site_key=?", (k,))
                st.rerun()
            if y3.button("🚫 Ne jamais contacter", key=f"xn_{k}"):
                db.execute("update contacts set status='ne jamais contacter', sheet_synced=0 where site_key=?", (k,))
                st.rerun()

with tab_check:
    st.caption("Formulaires **déjà envoyés** mais sans confirmation visible du site : on ne sait pas s'ils sont arrivés. "
               "Regarde la capture prise juste après l'envoi, puis classe-les. Pour en renvoyer un toi-même : "
               "🖥️ Ouvrir dans Chrome, envoie sur le site, puis ✔️ Bien arrivé.")
    ccols = [d[0] for d in db.execute("select * from contacts limit 0").description]
    to_check = [dict(zip(ccols, r)) for r in db.execute(
        "select * from contacts where status='à vérifier' order by sent_at desc limit 20")]
    if not to_check:
        st.info("Rien à vérifier.")
    for row in to_check:
        k = row["site_key"]
        with st.container(border=True):
            st.markdown(f"**{row['nom']}** · {row['ville'] or ''} · [🔗 page du formulaire]({row['form_url'] or row['site']}) · "
                        f"{row['template']} · envoyé le {(row['sent_at'] or '')[:16].replace('T', ' ')}  \n_{row['detail'] or ''}_")
            if row["shot_after"] and Path(row["shot_after"]).exists():
                with st.expander("Capture juste après l'envoi"):
                    st.image(row["shot_after"])
            z1, z2, z3 = st.columns(3)
            if z1.button("✔️ Bien arrivé", key=f"ck_{k}", type="primary"):
                db.execute("update contacts set status='envoyé', detail='confirmé à la main', sheet_synced=0 where site_key=?", (k,))
                st.rerun()
            if z2.button("🖥️ Ouvrir dans Chrome", key=f"co_{k}"):
                launch_detached([sys.executable, "ouvrir_formulaire.py", k], DATA / "ouvrir_formulaire.log")
                st.toast("Chrome s'ouvre avec le formulaire rempli (quelques secondes)…")
            if z3.button("❌ Pas arrivé", key=f"cx_{k}"):
                db.execute("update contacts set status='échec envoi', detail='non arrivé (vérifié à la main)', sheet_synced=0 "
                           "where site_key=?", (k,))
                st.rerun()

with tab_val:
    cols = [d[0] for d in db.execute("select * from contacts limit 0").description]
    pending = [dict(zip(cols, r)) for r in db.execute("select * from contacts where status='à valider' order by prepared_at limit 10")]
    if not pending:
        st.info("Aucun formulaire à valider pour le moment. Le bot en prépare en arrière-plan "
                "(il faut des fiches avec Opt-in = « oui » dans le Sheet).")
    for row in pending:
        k = row["site_key"]
        with st.container(border=True):
            st.markdown(f"### {row['nom']}  \n{row['categorie'] or ''} · {row['ville'] or ''} · "
                        f"{'⭐ ' + str(row['note']).replace('.', ',') if row['note'] is not None else ''} "
                        f"({row['nb_avis'] or 0} avis) · [site]({row['site']}) · [page du formulaire]({row['form_url']})")
            left, right = st.columns([3, 2])
            with left:
                if row["shot"] and Path(row["shot"]).exists():
                    st.image(row["shot"], caption="Formulaire tel que le bot l'a rempli (pas encore envoyé)")
            with right:
                st.caption(f"Modèle : **{row['template']}**")
                filled = json.loads(row["filled"] or "{}")
                st.caption("Champs remplis : " + ", ".join(f"{a} → « {b} »" for a, b in filled.items()))
                if row["detail"]:
                    st.warning(row["detail"])
                objet = st.text_input("Objet", row["objet"] or "", key=f"o_{k}")
                message = st.text_area("Message", row["message"], height=220, key=f"m_{k}")
                x1, x2, x3 = st.columns(3)
                if x1.button("✅ Envoyer", key=f"s_{k}", type="primary"):
                    db.execute("update contacts set status='à envoyer', objet=?, message=? where site_key=?", (objet, message, k))
                    st.rerun()
                if x2.button("⏭️ Passer", key=f"p_{k}"):
                    db.execute("update contacts set status='passé', sheet_synced=0 where site_key=?", (k,))
                    st.rerun()
                if x3.button("🚫 Ne jamais contacter", key=f"n_{k}"):
                    db.execute("update contacts set status='ne jamais contacter', sheet_synced=0 where site_key=?", (k,))
                    st.rerun()
    queued = db.execute("select count(*) from contacts where status='à envoyer'").fetchone()[0]
    if queued:
        st.caption(f"📤 {queued} formulaire(s) validé(s) en cours d'envoi par le bot.")

with tab_stats:
    st.caption("Par modèle de message. Les réponses viennent de la colonne « Réponse » du Sheet "
               "(intéressé / pas intéressé / STOP), à remplir quand une entreprise répond. "
               "Le même tableau est dans l'onglet « Analytics » du Sheet.")

    @st.cache_data(ttl=120, show_spinner="Lecture du Sheet…")
    def sheet_stats() -> pd.DataFrame:
        ws = open_sheet()
        values = ws.get_all_values()
        idx = {_hkey(h): i for i, h in enumerate(values[0])}
        g = lambda r, k: r[idx[k]].strip() if k in idx and idx[k] < len(r) else ""  # noqa: E731
        return pd.DataFrame([{"Modèle": g(r, "modele"), "Statut": g(r, "statutcontact"), "Réponse": g(r, "reponse")}
                             for r in values[1:] if g(r, "modele")])

    if st.button("🔄 Actualiser"):
        sheet_stats.clear()
    try:
        df = sheet_stats()
        names = [t["nom"] for t in cfg["templates"] if t["message"].strip()]
        rows = []
        for name in names + [n for n in df["Modèle"].unique() if n not in names] if len(df) else names:
            d = df[df["Modèle"] == name] if len(df) else df
            sent = int(d["Statut"].isin(["envoyé", "à vérifier"]).sum()) if len(d) else 0
            rep = int((d["Réponse"] != "").sum()) if len(d) else 0
            inter = int((d["Réponse"] == "intéressé").sum()) if len(d) else 0
            rows.append({"Modèle": name, "Envoyés": sent, "Réponses": rep,
                         "Taux de réponse": f"{rep / sent:.1%}" if sent else "—", "Intéressés": inter,
                         "Taux d'intérêt": f"{inter / sent:.1%}" if sent else "—",
                         "STOP": int((d["Réponse"] == "STOP").sum()) if len(d) else 0})
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
    except Exception as e:
        st.warning(f"Lecture du Sheet impossible : {e}")

with tab_hist:
    hist = pd.read_sql_query(
        "select nom as Entreprise, status as Statut, template as Modèle, coalesce(sent_at, prepared_at) as Date, "
        "detail as Détail, site as Site, shot_after from contacts where status != 'à valider' "
        "order by coalesce(sent_at, prepared_at) desc limit 300", db)
    st.dataframe(hist.drop(columns=["shot_after"]), hide_index=True, width="stretch",
                 column_config={"Site": st.column_config.LinkColumn()})
    sent = hist[hist["shot_after"].notna()]
    if len(sent):
        pick = st.selectbox("Voir la capture après envoi", sent["Entreprise"].tolist())
        path = sent[sent["Entreprise"] == pick]["shot_after"].iloc[0]
        if Path(path).exists():
            st.image(path)
    try:
        st.code("".join((DATA / "contact.log").read_text(encoding="utf-8").splitlines(keepends=True)[-30:]) or "—")
    except FileNotFoundError:
        pass
