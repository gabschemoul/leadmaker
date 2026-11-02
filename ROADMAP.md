# Prospectigo — Roadmap des améliorations

Liste vivante des idées et améliorations. On ajoute au fil de l'eau, on coche quand c'est livré.
Dernière mise à jour : 2 novembre 2026 (fin d'après-midi).

**Comment on publie** (depuis le 1er novembre 2026) :
1. Chaque développement part d'abord en pré-production, sur https://staging.prospectigo.com.
2. Gabriel teste là-bas.
3. prospectigo.com n'est mis à jour que quand Gabriel dit « publie ».

Légende de taille : 🟢 petit (quelques heures) · 🟡 moyen (une journée) · 🔴 gros (plusieurs jours)

---

## Coûts et marges de la recherche — plan VALIDÉ par Gabriel le 2 novembre 2026

**Le constat (mesures du 2/11)** : le seul vrai coût variable est le proxy DataImpulse de la recherche Google Maps (~1 $ le Go, facturé au poids). Prises de contact et serveurs : quelques euros par client et par mois. Une recherche (une activité dans un quartier) pèse ~2 Mo pour la liste + ~2 Mo par fiche ouverte. Le coût d'un prospect dépend des filtres : 18,6 prospects par recherche sans filtre de note, 4,5 avec note > 0,8, 1,4 en « mauvaises notes » (0,7-3,8). Sans proxy, depuis nos serveurs Hetzner, seule 1 recherche sur 3 aboutit (test du 2/11) : le proxy reste nécessaire.

**Forfaits DÉCIDÉS par Gabriel le 2 novembre 2026 — EN LIGNE sur prospectigo.com depuis le 2/11 vers 18h (publiés avec les n°13 et 14)** : facturation en dollars. Growth 499 $ / mois = 30 000 crédits de prospection + 15 000 prises de contact ; Business 990 $ = 80 000 + 40 000 ; Scale 1 999 $ = 200 000 + 100 000. Annuel = 10 mois (4 990 $ / 9 900 $ / 19 990 $). **Aucun plafond de prises de contact par jour** : seul le crédit mensuel limite (le réglage par campagne reste). Sièges 1 / 3 / 6, campagnes actives 1 / 3 / 10, crédits selon la difficulté (n°13) et budget proxy 50 / 100 / 200 Go (n°14) inchangés. Coût proxy mesuré : 3 à 13 % du prix au pire, marge > 85 %.
- **Fait en pré-production (2/11)** : forfaits en base (migration `20261102142404_leadmaker_plans_usd.sql` : nouveaux volumes, colonne `daily_send_limit` supprimée, `lm_queue_sends` ne regarde plus que la limite par campagne et le crédit mensuel), prix en dollars dans l'app (`billing.config.ts`, mensuel et annuel), cartes en « crédits de prospection » / « prises de contact », page Tarifs avec un encart « Comment les crédits fonctionnent » (1 crédit par prospect en général, 2 à 4 pour les campagnes difficiles, aucun plafond par jour, prix en USD), FAQ enrichie (question sur les crédits par prospect), mention du « plafond global du forfait » retirée du réglage d'envoi des campagnes. Les soldes déjà crédités (Namma Booster, Review Cleaner, jerem) ne bougent pas : les nouveaux volumes s'appliquent à la prochaine recharge.
- **Stripe mode réel** : marche à suivre dans `docs/prospectigo/stripe-mode-reel.md`, script `workers/scripts/stripe-create-prices.sh` pour créer les 3 produits et 6 prix en dollars sans faute de frappe.

### 10. Ne garder que « Je choisis moi-même » pour les activités 🟢 — EN LIGNE (publié le 2/11)
- Supprimer « Activités courantes » et « Toutes les activités » dans « Quelles entreprises ? ».
- Raison : « Toutes les activités » fait essayer les 3 896 activités Google (orphelinats, compagnies d'opéra…) avant de creuser celles qui rapportent. Campagnes concernées : « review cleaner » et « Namma test rapiditié » (Namma Booster).
- À décider avec Gabriel : que faire de ces deux campagnes déjà lancées (réduire leurs activités à celles qui ont rapporté ?).

### 11. Ouvrir moins de fiches Google Maps 🟡 — EN LIGNE (robots mis à jour le 2/11, validé)
- Échantillon du 2/11 (14 recherches en France et aux États-Unis, 282 fiches ouvertes) : ce n'est pas l'activité qui compte, c'est l'affichage de la liste.
  - Quand les cartes affichent leurs boutons (« Itinéraire »), une carte sans bouton « Website » n'a pas de site : 0 sur 107. Inutile de l'ouvrir.
  - Quand Google affiche une liste compacte, sans aucun bouton (restaurants, hôtels, coiffeurs, fleuristes, mais aussi dentistes à Chicago), le site n'est visible que sur la fiche : 149 sur 173 en avaient un. On continue à les ouvrir.
- Aussi corrigé : pour les artisans sans adresse (plombiers, électriciens…), le robot ouvrait la fiche juste pour lire l'activité. Elle est maintenant lue sur la carte.
- Contrôle : plombiers à Lyon, 36 prospects gardés avant comme après, 0 fiche ouverte au lieu de 7 à 11, 9 secondes au lieu de 32.
- Le gain réel en proxy sera mesuré sur le vrai trafic après la mise à jour des robots.
- **Mis en ligne le 2/11 à 12h48**, vérifié 10 min : 0 plantage, ~3 100 prospects/h, 1,7 Mo par prospect (2 avant).
- **Estimation des listes compactes (2/11, après-midi)** : l'estimation (qui n'ouvre jamais les fiches) comptait « sans site » toutes les cartes d'une liste compacte, d'où des restaurants, hôtels, coiffeurs… très sous-estimés. Elle compte maintenant ces cartes à 86 % (149 sur 173 dans l'échantillon), de façon fixe par fiche pour que le dédoublonnage reste juste. Contrôle à Lyon sans ouvrir de fiche : Restaurant 0 → 111 « avec site » sur 120 cartes, Hôtel 0 → 99, Plombiers inchangés (89). Robots à mettre à jour.

### 12. Choisir les activités qui rapportent, abandonner vite les autres 🟡 — EN LIGNE (2/11, validé : 5 140 prospects/h, 0,45 Mo par prospect sur « Namma test rapiditié »)
- **Avant** : le robot essayait chaque activité une fois avant de creuser les bonnes. Sur « Namma test rapiditié » (3 896 activités), 1 090 activités essayées, 392 ont rapporté, 0 abandonnée ; 1 300 recherches en file dont ~1 230 sur des activités jamais essayées.
- **Maintenant** (tout est dans la base, les robots n'ont pas besoin d'être mis à jour) :
  - Sur 6 places de recherche par campagne, 2 explorent une activité jamais essayée (les générales d'abord), 4 creusent l'activité qui rapporte le plus (prospects par recherche, en comptant les recherches en cours pour répartir entre les meilleures). Réglages `explore_share` (1/4) et `abandon_zero_after` (5) dans `lm_discovery_settings`.
  - Une activité sans aucun prospect après 5 recherches est abandonnée (les 5 premiers quartiers sont les plus peuplés, donc c'est fiable). L'ancienne règle (moins de 5 % par recherche après 40) reste. Une recherche échouée (proxy) ne compte pas.
  - Écran Trouver : nouveau compteur « Activités qui rapportent ».
- **Correctif pause (2/11, 13h)** : mettre une campagne en pause annulait ses recherches en file sans libérer leurs places (`in_flight`), d'où 646 + 626 places fantômes sur les 2 campagnes de Namma Booster. Maintenant la pause libère les places, la reprise recompte à partir des vraies tâches (`lm_recount_in_flight`), et le balayage des robots bloqués libère la place d'une recherche passée en échec. Le script `replan_discovery.py` traite aussi les campagnes en pause et recompte.
- **Mise en ligne** (par Gabriel, n°11 validé le 2/11) : 1) `cd ~/LeadMaker/app/apps/web && pnpm exec supabase db push` (2 migrations ; la nouvelle planification démarre aussitôt sur les robots en place) ; 2) `workers/.venv/bin/python -I workers/scripts/replan_discovery.py` puis `--apply` depuis `~/LeadMaker/app` : retire les recherches d'exploration déjà planifiées (en file ou annulées par la pause) et remet les compteurs d'aplomb ; 3) relancer les 2 campagnes dans l'app ; 4) vérifier 15 min après : prospects par recherche en hausse, répartition des recherches par activité.
- Tests de base : `leadmaker-discovery-explore.test.sql` (22 vérifications), pause/reprise dans `leadmaker-discovery.test.sql`.

### 13. Crédits selon la difficulté de la campagne 🟡 — EN LIGNE (publié le 2/11 vers 18h)
- Tarif fixé au lancement à partir de l'estimation (part des entreprises qui passent les filtres) et affiché avant de lancer : ≥ 10 % = 1 crédit par prospect, 3-10 % = 2, 1-3 % = 3, < 1 % = 4 (seuils provisoires, réglables dans `lm_discovery_settings.credit_tiers`).
- **Comment ça marche** : l'estimation (« Estimer le nombre de prospects ») calcule le taux et affiche « Tarif : 2 crédits de prospection par prospect ». Au premier lancement, la campagne reprend le tarif de l'estimation faite avec exactement son ciblage et ses filtres, et le garde pour toujours (modifier la campagne ensuite ne le change pas). S'il n'y a pas d'estimation, le clic sur « Lancer » lance d'abord la mesure (30 recherches, 1 à 4 minutes), l'onglet Trouver affiche « Mesure : 12 sur 30 » puis le tarif, et on clique de nouveau sur « Lancer ». Chaque prospect débite ce tarif ; une campagne déjà lancée avant cette version reste à 1 crédit.
- **Classement des activités par prospects par Mo** (et non plus par recherche) : le robot attribue le vrai trafic de chaque recherche à son activité ; le planificateur creuse l'activité qui rapporte le plus de prospects par Mo de proxy (« Hotel » rapporte mais coûte ~35 Mo par recherche, il passe derrière). Sans mesure, 4 Mo par recherche sont supposés.
- Vérifié en local le 2/11 : brouillon « Boulangeries Lyon 20 km » → Lancer → mesure 30 recherches en 3 min 38 → 6,8 % → 2 crédits → lancement, tarif figé, pause. Test de base `leadmaker-credit-difficulty.test.sql` (31 vérifications).
- **Mise en ligne** (la base est partagée avec prospectigo.com, donc en même temps que la publication) : voir « Publication forfaits + n°13 + n°14 » ci-dessous. Tant que la migration n'est pas poussée, l'onglet Trouver de la pré-production affiche « Mesuré au lancement » et le lancement marche comme avant.

### 14. Budget de proxy invisible par client 🟡 — EN LIGNE (publié le 2/11 vers 18h)
- Filet de sécurité : ≈ 10 % du prix en Go par mois (Growth 50 Go, Business 100, Scale 200 ; réglable dans `lm_plans.proxy_gb_month`, vide = pas de plafond). Au-delà, la recherche du client ralentit au lieu de coûter plus.
- **Comment ça marche** : chaque recherche et chaque estimation ajoute son vrai trafic au compteur du compte (`lm_account_credits.proxy_bytes_period`), remis à zéro à chaque recharge de crédits. Quand le compteur atteint le budget du forfait, le compte entier n'a plus qu'**une recherche à la fois** toutes campagnes confondues (réglage `over_budget_tasks_per_account`), au lieu de 6 par campagne : environ 6 à 18 fois plus lent. Rien n'est affiché au client, rien n'est facturé en plus. Le plafond quotidien global (8 Go/jour) reste en place.
- Tests de base `leadmaker-proxy-budget.test.sql` (9 vérifications). Les comptes actuels (Namma Booster = Scale 200 Go, Review Cleaner = Business 100 Go, jerem = Scale) partent d'un compteur à zéro à la mise en ligne.
- **Mise en ligne** : avec le n°13 (même `db push`, puis `deploy-robots.sh` : le robot compte aussi le trafic des estimations).

### Publication forfaits + n°13 + n°14 — FAITE le 2/11 vers 18h (main = 304fe9b9)
Déroulé suivi (base, puis site, puis robots ; test avant bascule) — à réutiliser pour les prochaines publications qui touchent la base et les robots :
1. **Base** (3 migrations : `20261102133517_leadmaker_credit_difficulty`, `20261102134915_leadmaker_proxy_budget`, `20261102142404_leadmaker_plans_usd`) : `cd ~/LeadMaker/app/apps/web && pnpm exec supabase db push`. Compatible avec le site en ligne actuel : les anciennes fonctions gardent leur signature, le tarif des campagnes existantes reste 1 crédit, les compteurs de proxy partent de zéro, la file d'envoi ne regarde plus le plafond du forfait (déjà à 100 000 en ligne, donc aucun changement visible).
2. **Contrôle base** (1 min) : `select id, discovery_credits, outreach_credits, proxy_gb_month from lm_plans` → 30 000/15 000, 80 000/40 000, 200 000/100 000 et 50/100/200 ; une campagne en cours continue à produire des prospects.
3. **Site** : `git checkout main && git merge --ff-only staging && git push && git checkout staging` (Vercel déploie prospectigo.com en ~3 min). Vérifier /pricing (dollars, encart crédits), /faq (7 questions), l'onglet Trouver d'une campagne (tarif en crédits).
4. **Robots** (serveur principal seulement) : `./workers/scripts/deploy-robots.sh` → test automatique avant bascule ; si le test échoue, rien ne change. Le robot nouvelle version attribue le trafic de chaque recherche à son activité et au compteur du compte (n°13, n°14).
5. **Vérification 10-15 min** : `lm_tasks.result.proxy_bytes` renseigné, `lm_campaign_categories.proxy_bytes` et `lm_account_credits.proxy_bytes_period` qui montent, 0 erreur dans les logs, prospects par heure inchangés. En cas de souci : `deploy-robots.sh --rollback` (robots) ; la base n'a pas besoin de retour arrière.
6. **Après** : Stripe en mode réel (`docs/prospectigo/stripe-mode-reel.md`), puis fixer les comptes existants au nouveau forfait si Gabriel le veut (`lm_reset_credits`).
- **Bilan du 2/11** : 3 migrations poussées (volumes 30k/15k, 80k/40k, 200k/100k et 50/100/200 Go vérifiés en ligne), site déployé (dollars, encart crédits, FAQ), robots du serveur principal basculés après test réussi (fichiers identiques au commit publié, 0 erreur dans les 5 premières minutes). Aucune campagne ne tournait au moment de la publication : la vérification du trafic attribué aux activités et au compteur du compte (n°13, n°14) se fera à la prochaine campagne relancée. Les commits plus récents de staging (e-mails FR n°16, surveillant n°17, packs) ne sont PAS publiés.

---

## Idées de Gabriel (1er novembre 2026)

### 1. Dupliquer une campagne dans une autre équipe 🟢
- **Aujourd'hui** : « Dupliquer » crée la copie dans la même équipe.
- **Demain** : au moment de dupliquer, on choisit l'équipe de destination parmi celles dont on est membre.
- **Décidé (1/11)** : au moment de dupliquer, une case « Copier aussi les contacts » laisse le choix de prendre les prospects déjà trouvés ou seulement les réglages (villes, activités, messages).

### 2. Choisir « une ville et ses alentours » d'un seul clic 🟡 — LIVRÉ (1/11)
- **Le problème** : il a fallu 2 h pour saisir Lyon, Villeurbanne, Bron, etc. une par une.
- **La solution** : en tapant « Lyon », une option « Lyon et alentours » apparaît, avec un rayon réglable (10, 20, 30 km). Un clic ajoute toutes les communes dans ce rayon.
- **Bonus** : la liste ajoutée s'affiche avant de valider, pour retirer une commune en trop.
- **Faisable facilement** : l'app connaît déjà la position GPS et la population de chaque ville, dans tous les pays.
- **Option** : seuil de population minimum, pour ignorer les hameaux.

### 3. Modèles de campagne 🟡 (à réfléchir plus tard)
Pistes à discuter :
- **Modèle perso** : enregistrer une campagne existante comme modèle (activités, messages, réglages d'envoi), puis « Nouvelle campagne à partir d'un modèle ».
- **Modèles fournis par Prospectigo** : quelques campagnes prêtes à l'emploi par métier (ex. « Agence web → artisans du bâtiment »), avec messages déjà rédigés.
- **Partage** : un modèle visible par toute l'équipe, voire entre équipes.
- À noter : la duplication de campagne couvre déjà une partie du besoin.

### 4. Importer des contacts dans une campagne 🟢
- **Aujourd'hui** : on peut déjà importer un fichier CSV, mais seulement dans un dossier (page Prospects). Les contacts ne sont rattachés à aucune campagne.
- **Demain** : bouton « Importer » sur la page d'une campagne. Les contacts importés suivent ensuite le même chemin que ceux trouvés sur Google Maps (préparation des formulaires, e-mails, envoi).
- **Aussi** : pouvoir rattacher des prospects déjà importés à une campagne existante (action groupée).

### 5. Acheter des crédits supplémentaires 🟡 — tarifs DÉCIDÉS le 2/11
- **Le principe** : quand les crédits du mois sont épuisés, on achète un pack en plus sans changer de forfait.
- **Décidé (2/11)** : packs MIXTES, un seul prix, même proportion que les forfaits (2 prospects pour 1 prise de contact) :
  - S : 5 000 crédits de prospection + 2 500 crédits de prise de contact = 99 $
  - M : 15 000 + 7 500 = 279 $
  - L : 30 000 + 15 000 = 549 $
  - Environ 10 à 20 % plus cher que dans Growth : monter de forfait reste plus intéressant. Marge > 85 %.
- **Décidé** : un seul tarif pour tout le monde ; réservé aux abonnés (forfait actif) ; crédits achetés valables 12 mois ; on consomme d'abord ceux du forfait (1/11).
- **Plus tard (Gabriel, 2/11 : « d'abord une plateforme clean »)** : rechargement automatique (interrupteur, pack choisi, seuil 10 %, 3 rechargements max par mois, gestion 3D Secure et carte refusée).
- Dépend de Stripe en mode réel.

### 6. Plusieurs profils d'expéditeur 🟡
- **Aujourd'hui** : un seul expéditeur par dossier client (nom, société, e-mail, téléphone…).
- **Demain** : plusieurs expéditeurs par dossier, par exemple un par commercial ou un par marque. On choisit l'expéditeur dans chaque campagne, et un expéditeur par défaut est proposé.
- **À trancher** : pouvoir alterner automatiquement entre plusieurs expéditeurs dans une même campagne, pour répartir les réponses.

### 7. Beaucoup plus de champs remplis dans les formulaires 🟡
- **Aujourd'hui** : le robot remplit les champs classiques. Civilité, prénom, nom, fonction, société, e-mail, téléphone, site web, adresse, code postal, ville, pays, objet et message.
- **Demain** : des champs plus rares, renseignés une fois dans l'expéditeur et reconnus par le robot. Exemples :
  - Téléphone mobile et téléphone fixe séparés, fax.
  - Numéro d'entreprise (SIRET, TVA intracommunautaire, numéro d'entreprise étranger).
  - Secteur d'activité, taille de l'entreprise, nombre de salariés.
  - Département ou région, langue préférée.
  - Budget, délai ou date souhaitée, objet de la demande dans une liste.
  - « Comment nous avez-vous connu ? », moyen de contact préféré, créneau de rappel.
  - Profil LinkedIn, numéro de client.
- **Champs libres** : l'utilisateur ajoute ses propres champs (un libellé et une valeur), utilisés quand le robot reconnaît le libellé sur un site.
- **Plus tard** : l'IA du robot (point 8 de la liste ci-dessous) devine la bonne réponse quand un champ ne correspond à rien de connu.

### 8. Mettre les utilisateurs sur des rails (refonte du parcours) 🔴 — V1 EN PRÉ-PROD (1/11)
- **Le problème** : à la première connexion on ne sait pas par où commencer ; campagnes, prospects, formulaires et expéditeur sont au même niveau.
- **Décisions du 1/11** :
  - La campagne devient le fil conducteur, en 4 onglets dans l'ordre : Cibler, Trouver, Rédiger, Contacter. Chaque onglet a son propre bouton.
  - Le message doit exister avant de préparer les formulaires (rappel avec bouton dans Contacter).
  - Première connexion guidée en 3 questions : qui envoie, qui cibler, quel message. **Pas en V1** (décidé le 1/11), la maquette reste pour plus tard.
  - Tableau de bord = « vos prochaines actions », une ligne par campagne.
  - Menu simplifié : Tableau de bord, Campagnes, Prospects ; le reste dans Réglages.
  - Dossier client caché par défaut. À activer de façon maligne : question à l'inscription (« pour vous ou pour vos clients ? ») ou lié au forfait (Business/Scale = agences). À trancher.
- **Décidé (1/11)** : en V1, les formulaires s'affichent uniquement dans la campagne. La vue « Tout à vérifier » viendra plus tard.
- **Maquette cliquable** (1/11) : https://claude.ai/artifact/9V1UaisbvCMCc4i18cMYnD (campagne en 4 onglets, première connexion, tableau de bord). Validée par Gabriel le 1/11.
- **Découpage V1** : 1) page de campagne en 4 onglets ✅, 2) tableau de bord « prochaines actions » + menu simplifié ✅, 3) dossier client caché quand il n'y en a qu'un ✅ (le 1/11, en pré-production, à publier).

### 9. Adaptation automatique des robots 🔴 — VALIDÉ (1/11)
- **Le principe** : 6 robots de recherche garantis par campagne active (pas par compte). Des serveurs Hetzner, facturés à l'heure, sont créés quand des campagnes démarrent et supprimés quand la file est vide.
- **Coût** : environ 1,5 centime de serveur par heure et par campagne active, plus le proxy consommé.
- **Garde-fous** : la limite de campagnes actives par forfait (1 / 3 / 10) et le plafond quotidien de proxy (fait le 1/11, 3 Go par jour).
- **À prévoir** : demander à Hetzner d'augmenter la limite de serveurs du compte ; base Supabase à agrandir au-delà de 100-150 robots.
- **Aussi** : adapter le seuil d'abandon des activités (5 % après 40 recherches) aux campagnes très sélectives, comme « mauvaises notes ».

---

### 15. Fil d'activité en direct sur la campagne 🟡 — idée de Gabriel (2/11), lignes à définir ensemble
- **Le principe** : dès qu'on lance la recherche ou les prises de contact d'une campagne, un fil de lignes défile, comme dans Claude Code quand il travaille. Ça montre qu'il se passe quelque chose : plus pro, plus sérieux, rassurant.
- **Règle proposée** : chaque ligne correspond à un vrai événement (jamais de texte décoratif), pour que le fil reste crédible même quand la recherche ralentit ou s'arrête.
- **Exemples de lignes possibles (à valider)** :
  - Recherche : « Campagne lancée », « Lyon découpée en 12 secteurs », « 1 840 recherches planifiées », « Recherche « Plombier » à Lyon 3e : 120 fiches lues, 14 prospects gardés », « Nouvelle activité essayée : Chauffagiste », « Activité abandonnée : aucun prospect après 5 recherches », « Campagne en pause ».
  - Prises de contact : « Formulaires en préparation : 25 sites », « Formulaire trouvé sur dupont-plomberie.fr/contact », « Message envoyé à Dupont Plomberie », « Site inaccessible, passé ».
- **À trancher** : le niveau de détail (une ligne par recherche ou un résumé par minute), et ce qu'on ne montre jamais (plafond de proxy, budget par client, pannes internes).

### 16. E-mails de l’app en français, aux couleurs de Prospectigo 🟢 — EN LIGNE le 2/11 vers 18h30 (invitation, code, suppression) ; e-mails de connexion Supabase poussés le 2/11 vers 19h (`push-auth-emails.sh`, jeton dans `.env.supabase-token`)
- **Deux familles d’e-mails** : ceux envoyés par l’application (invitation à rejoindre une équipe, code de vérification, confirmation de suppression de compte) et ceux envoyés par Supabase, le service de connexion (confirmation d’adresse à l’inscription, mot de passe oublié, changement d’adresse, lien de connexion).
- **Langue** : chaque e-mail part dans la langue de la personne. Pour l’invitation et le code : la langue de l’interface de celui qui déclenche l’envoi. Pour les e-mails de connexion : la langue de l’interface au moment de l’inscription (mémorisée sur le compte) ; sans indication, français. Un utilisateur inscrit avant cette version reçoit les e-mails en français.
- **Apparence** : logo texte Prospectigo avec le point jaune, bouton vert, carte blanche sur fond gris-vert (thème Atlas), même gabarit pour tous.
- **Mise en ligne** : l’invitation et le code suivent la publication normale (staging → main). Les e-mails de connexion sont réglés dans Supabase, partagé par prospectigo.com et la pré-production : `./apps/web/scripts/push-auth-emails.sh` (jeton personnel Supabase à créer une fois), à lancer au « publie ». Les modèles sont générés par `apps/web/scripts/generate-auth-emails.py`.

### 17. Alerte quand les robots n’avancent plus 🟢 — EN LIGNE le 2/11 vers 18h30 (surveillants `watch` et `watch-send` démarrés sur les deux serveurs, clé Resend et adresse d’alerte en place)
- **Le principe** : un petit surveillant tourne sur chaque serveur. Toutes les 2 minutes il regarde la base : y a-t-il du travail à faire (recherches dont l’heure est venue, formulaires à préparer, messages validés à envoyer) et quelque chose s’est-il terminé depuis 20 minutes ? Si du travail attend et que rien ne se termine, Gabriel reçoit un e-mail (Resend, depuis noreply@prospectigo.com).
- **Deux surveillants, croisés** : le serveur principal surveille les prises de contact (robots d’envoi, sur l’autre serveur), le serveur d’envoi surveille la recherche. Si un serveur meurt entièrement, l’autre le signale. Base de données injoignable 10 minutes → alerte aussi.
- **Pas de fausse alerte** pour les pauses normales : campagne en pause, plafond quotidien de proxy atteint (recherches reportées à demain), crédits épuisés, limite d’envois du jour d’une campagne atteinte.
- **Rythme** : une alerte au début, un rappel toutes les 2 h tant que ça dure, un « c’est reparti » à la reprise. L’e-mail dit ce qui est bloqué depuis quand, combien de tâches attendent, les campagnes concernées, si des robots sont encore vus, les dernières erreurs, et quoi faire (retour arrière avec `deploy-robots.sh --rollback`).
- **Testé le 2/11** en local avec une tâche bloquée artificielle : e-mail d’alerte puis e-mail de reprise reçus.
- **Mise en ligne** (par Gabriel) : 1) `./workers/scripts/set-alert-email.sh` (dépose la clé Resend sur les deux serveurs et envoie un e-mail d’essai depuis chacun) ; 2) `./workers/scripts/deploy-robots.sh --all` (installe le surveillant avec le reste). Réglages possibles dans le `.env` des serveurs : `ALERT_EMAIL`, `WATCH_STALL_MINUTES` (20), `WATCH_REMIND_HOURS` (2).

### 18. Étape « Contacter » : pilote automatique + mode Avancé 🟡 — DÉCIDÉ le 2/11, maquette en cours de validation
- **Le problème** : préparer, vérifier, envoyer (a/b/c) est fastidieux et peu naturel.
- **Pilote automatique (mode par défaut)** : une seule question, « Combien d'entreprises voulez-vous contacter ? » (plafonné aux crédits et aux prospects pas encore contactés), un rythme (le plus vite possible / par jour), puis le robot prépare et envoie dans la foulée, prospect après prospect, jusqu'au nombre choisi. Suivi en direct (envoyés / en cours / mis de côté) et bouton Pause.
- **Cas douteux** (captcha, champ inconnu, pas de formulaire) : mis de côté, sans crédit dépensé ; on les retrouve dans « Vérifier » du mode Avancé.
- **Décidé (2/11)** : ouvert à TOUS les forfaits (la validation automatique n'est plus réservée à Business/Scale) ; prospects pris dans l'ordre où ils ont été trouvés ; aperçu des 3 premiers formulaires avant d'envoyer pour la première campagne ; pilote automatique par défaut, Avancé à un clic.
- **Choix du message (2/11)** : on coche un ou plusieurs des 4 messages de l'étape Rédiger ; plusieurs cochés = test A/B, envoyés à parts égales. Pour savoir lequel « gagne », il faut le suivi des réponses (lot 3) : sans lui, on ne compte que les envois par message.
- **Mode Avancé** : l'écran actuel (a/b/c).
- **Maquette cliquable** : https://claude.ai/artifact/9NemsP4RpCnLuPMCL8PZ6W
- Vocabulaire (2/11) : ne plus écrire « robot » dans l'app et le site, mais « Prospectigo » (≈ 23 textes à reprendre, dans la même livraison).
- À revoir aussi plus tard : l'étape 3 « Rédiger ».

## Déjà prévu (liste du 31 octobre)

1. **Premier envoi réel surveillé** sur 2-3 entreprises choisies par Gabriel. Le robot d'envoi reste coupé tant que Gabriel ne dit pas « Envoie ».
2. **Test de volume** une fois le premier envoi validé.
3. **Stripe en mode réel** (paiements et abonnements pour de vrai) : marche à suivre écrite le 2/11 dans `docs/prospectigo/stripe-mode-reel.md`, à faire par Gabriel après la publication des forfaits.
4. **Design** : couleurs plus agréables, vrai logo, remplacer le tableau de bord de démonstration.
5. ~~**E-mails de l'app** (invitations, mots de passe) envoyés depuis une adresse @prospectigo.com.~~ Resend branché le 2/11 ; textes français et couleurs : n°16.
6. **Nettoyage** : supprimer le projet en double chez Vercel, supprimer l'équipe « Review » de Nath une fois qu'il a rejoint Namma Booster.
7. **Lot 3** : tableau de bord, statistiques par message, suivi des réponses.
8. **IA dans le robot** pour les cas douteux : choisir la bonne adresse e-mail, reconnaître un formulaire atypique, juger si le message est bien parti.
9. **Réserve partagée des fiches Google Maps** : une zone déjà scannée il y a moins de 30 jours est servie sans retourner sur Google.
10. **Captchas** : module fait par l'équipe.
11. ~~Remettre les plafonds d'envoi avant le premier client~~ → ANNULÉ le 2/11 : Gabriel a décidé qu'il n'y a pas de plafond par jour, seul le crédit mensuel limite.
12. **Base de données séparée pour la pré-production** (décidé le 1/11, à faire plus tard, quand de vrais clients seront en ligne). Aujourd'hui staging.prospectigo.com partage les données de prospectigo.com.

---

## Livré
- ~~Mettre une campagne en pause arrête le robot entre deux fiches (plus de prospects qui arrivent pendant 5 min « en pause »)~~ (2/11, robots mis à jour 14h25)
- ~~Modifier une campagne, même lancée~~ (31/10)
- ~~Dupliquer une campagne~~ (31/10)
- ~~Le lien d'invitation n'est plus perdu à l'inscription~~ (1/11)
- ~~Ajouter une ville et ses alentours en un clic~~ (1/11)
