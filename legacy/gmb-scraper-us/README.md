# Scraper Google Maps — version États-Unis

Deux outils, utilisables depuis n'importe où par un lien Internet protégé par mot de passe :

- **🤖 Scan automatique** : toutes les catégories Google × toutes les villes des 50 États (≈ 20 800 villes,
  des plus peuplées aux plus petites). Garde les fiches avec site web, note entre 0,8 et 3,5 et au moins 1 avis.
  Exclut les administrations (city/county/state government, DMV, police, tribunaux, postes, écoles publiques…),
  les banques et credit unions, et les grandes chaînes (Walmart, McDonald's, Home Depot…). Un même site web
  vu sur 5 fiches ou plus est aussi traité comme une chaîne. Les fiches vont dans l'onglet « Scan auto » du Sheet.
- **✉️ Bot de contact** : remplit en anglais les formulaires de contact des fiches dont la colonne **Opt-in**
  vaut « oui ». Rien ne part sans validation (envoi groupé ou un par un). Statuts reportés dans le Sheet.

## Installation (une seule fois)

1. Copier ce dossier sur le Mac (pas dans iCloud Drive).
2. Double-cliquer sur **« 1 - Installer.command »** (5 à 10 minutes).
   Si macOS bloque le fichier : clic droit → Ouvrir → Ouvrir.

## Utilisation

- **« 2 - Lancer.command »** : démarre les deux interfaces et affiche leurs **liens Internet**
  (aussi écrits dans `LIENS.txt`). Les liens changent à chaque lancement.
- **« 3 - Arrêter.command »** : arrête les interfaces et les liens.
  Le scan et le bot de contact se démarrent / s'arrêtent depuis leur interface (▶️ / ⏹️).

Le Mac doit rester allumé (le scan empêche la mise en veille tant qu'il tourne).

## Google Sheet

Le lien du Sheet se change sur la page d'accueil. Le Sheet doit être partagé **en éditeur** avec l'adresse
du compte de service affichée sur cette page. Les onglets « Scan auto » et « Analytics » et les colonnes du bot
(Opt-in, Statut contact, Date contact, Modèle, Réponse) sont créés automatiquement.

## Mot de passe

Demandé à l'ouverture de chaque interface. Il se change sur la page d'accueil.
