# Prospectigo — Roadmap des améliorations

Liste vivante des idées et améliorations. On ajoute au fil de l'eau, on coche quand c'est livré.
Dernière mise à jour : 1er novembre 2026.

**Comment on publie** (depuis le 1er novembre 2026) :
1. Chaque développement part d'abord en pré-production, sur https://staging.prospectigo.com.
2. Gabriel teste là-bas.
3. prospectigo.com n'est mis à jour que quand Gabriel dit « publie ».

Légende de taille : 🟢 petit (quelques heures) · 🟡 moyen (une journée) · 🔴 gros (plusieurs jours)

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

### 5. Acheter des crédits supplémentaires 🟡
- **Le principe** : quand les crédits du mois sont épuisés, on achète un pack en plus sans changer de forfait, comme dans Claude.
- **Ce qu'il faut** : des packs (ex. 1 000 / 5 000 / 10 000 envois), paiement Stripe en une fois, crédits ajoutés tout de suite.
- **Décidé (1/11)** : les crédits achetés restent valables 12 mois, et on consomme d'abord ceux du forfait.
- **À trancher** : prix des packs.
- **Option** : rechargement automatique quand le solde passe sous un seuil.
- Dépend du branchement de Stripe en mode réel (voir plus bas).

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

### 8. Mettre les utilisateurs sur des rails (refonte du parcours) 🔴 — EN RÉFLEXION (1/11)
- **Le problème** : à la première connexion on ne sait pas par où commencer ; campagnes, prospects, formulaires et expéditeur sont au même niveau.
- **Décisions du 1/11** :
  - La campagne devient le fil conducteur, en 4 onglets dans l'ordre : Cibler, Trouver, Rédiger, Contacter. Chaque onglet a son propre bouton.
  - Le message doit exister avant de préparer les formulaires (rappel avec bouton dans Contacter).
  - Première connexion guidée en 3 questions : qui envoie, qui cibler, quel message.
  - Tableau de bord = « vos prochaines actions », une ligne par campagne.
  - Menu simplifié : Tableau de bord, Campagnes, Prospects ; le reste dans Réglages.
  - Dossier client caché par défaut. À activer de façon maligne : question à l'inscription (« pour vous ou pour vos clients ? ») ou lié au forfait (Business/Scale = agences). À trancher.
- **Décidé (1/11)** : en V1, les formulaires s'affichent uniquement dans la campagne. La vue « Tout à vérifier » viendra plus tard.
- **Maquette cliquable** (1/11) : https://claude.ai/artifact/9V1UaisbvCMCc4i18cMYnD (campagne en 4 onglets, première connexion, tableau de bord). En attente du retour de Gabriel.

---

## Déjà prévu (liste du 31 octobre)

1. **Premier envoi réel surveillé** sur 2-3 entreprises choisies par Gabriel. Le robot d'envoi reste coupé tant que Gabriel ne dit pas « Envoie ».
2. **Test de volume** une fois le premier envoi validé.
3. **Stripe en mode réel** (paiements et abonnements pour de vrai).
4. **Design** : couleurs plus agréables, vrai logo, remplacer le tableau de bord de démonstration.
5. **E-mails de l'app** (invitations, mots de passe) envoyés depuis une adresse @prospectigo.com. À faire avant d'ouvrir à d'autres utilisateurs.
6. **Nettoyage** : supprimer le projet en double chez Vercel, supprimer l'équipe « Review » de Nath une fois qu'il a rejoint Namma Booster.
7. **Lot 3** : tableau de bord, statistiques par message, suivi des réponses.
8. **IA dans le robot** pour les cas douteux : choisir la bonne adresse e-mail, reconnaître un formulaire atypique, juger si le message est bien parti.
9. **Réserve partagée des fiches Google Maps** : une zone déjà scannée il y a moins de 30 jours est servie sans retourner sur Google.
10. **Captchas** : module fait par l'équipe.
11. **Base de données séparée pour la pré-production** (décidé le 1/11, à faire plus tard, quand de vrais clients seront en ligne). Aujourd'hui staging.prospectigo.com partage les données de prospectigo.com.

---

## Livré
- ~~Modifier une campagne, même lancée~~ (31/10)
- ~~Dupliquer une campagne~~ (31/10)
- ~~Le lien d'invitation n'est plus perdu à l'inscription~~ (1/11)
- ~~Ajouter une ville et ses alentours en un clic~~ (1/11)
