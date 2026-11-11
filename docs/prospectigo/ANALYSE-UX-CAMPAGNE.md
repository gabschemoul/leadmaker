# Analyse UX : le parcours d'une campagne

> 11/11/2026. Version analysée : pré-prod (`staging`, commit `7fb41e47`).
> Méthode : lecture complète des écrans de campagne, de tous leurs textes (fr), des règles en base et des robots.
> Pas de test avec de vrais utilisateurs : chaque point ci-dessous est un constat sur ce que l'appli fait **aujourd'hui**,
> avec sa preuve, pour pouvoir être contesté point par point.

---

## Comment lire ce document

- Chaque problème a un **numéro** (ex. `E-03`) pour pouvoir en discuter : « je conteste E-03 parce que… ».
- **Gravité** :
  - **P0 – grave** : fait perdre de l'argent ou la confiance du client, envoie quelque chose qu'il n'a pas voulu, ou le bloque.
  - **P1 – important** : le client se trompe, ne comprend pas, ou doit sortir de l'appli pour réussir.
  - **P2 – gêne** : ralentit, déroute, mais il s'en sort.
  - **P3 – finition**.
- **Preuve** : où ça se voit dans le code (pour Nath ou un dev). Le client n'a pas besoin de la lire.
- Les **décisions déjà actées** (CDC du 9/11, choix du 10/11) sont respectées. Quand un problème touche une décision,
  c'est écrit explicitement (« ⚖️ touche une décision ») et la recommandation reste compatible avec elle,
  ou devient une question à trancher.

Préfixes : `L` liste des campagnes · `Q` écran « Qui ? » · `E` « Vos entreprises » · `M` « Votre message » ·
`V` « Envoi » · `R` « Résultats » · `S` règles en coulisses (base, robots) · `T` transversal · `C` cas limites.

---

## 1. Résumé en une page

### Ce qui marche bien

1. **Le point de départ est juste** : « Qui voulez-vous contacter ? » en une phrase, comme à un collègue. C'est
   compréhensible par n'importe qui, sans connaître les catégories de fiches.
2. **Le tri IA avec sa raison en une phrase** (« Agence web, développe ses sites ») rend le travail de Prospectigo visible.
3. **Le parcours en 5 étapes nommées comme des questions** (Qui ? / Vos entreprises / Votre message / Envoi / Résultats)
   se lit tout seul, et l'appli ouvre directement la bonne étape.
4. **Le fil « En direct » du pilote** montre de vrais événements (visite, formulaire trouvé, envoyé, mis de côté).
5. **Les erreurs de lancement ne font rien perdre** : la campagne est enregistrée, le message dit quoi faire.

### Les 16 problèmes les plus graves

| # | Problème | Gravité |
|---|---|---|
| Q-01 | Chaque nouvelle campagne garde **seulement les entreprises notées entre 1 et 3,5**, avec au moins 1 avis et un site, sans que le client le voie (pli « Plus de critères » fermé). Une campagne « agences marketing » ignore donc en silence presque toutes les agences bien notées. | P0 |
| T-03 | **L'argent est invisible pendant tout le parcours** : ni le prix d'une entreprise gardée (1, 2 ou 4 crédits), ni le solde, ni ce que la campagne a déjà coûté. Le prix existe mais il est rangé dans une bulle « i » masquée. | P0 |
| Q-09 | **Aucun plafond de dépense par campagne** : « Lancer la recherche » peut consommer tout le solde du mois, sans récapitulatif ni confirmation. | P0 |
| V-01 | **Un seul clic envoie de vrais messages à 500 entreprises** (valeur par défaut), sans récapitulatif, sans confirmation, et sans que le client ait jamais vu un vrai formulaire rempli (l'aperçu des 3 premiers est masqué). | P0 |
| T-08 | **L'export « Exporter » d'une campagne sort toutes les fiches trouvées**, y compris les écartées et les « à vérifier » non payées (site, téléphone…). Fuite de valeur et contraire au CDC (« seulement des fiches payées »). | P0 |
| M-01 | **Le test A/B est une promesse vide** : l'écran Message invite à écrire une version B, mais l'Envoi ne coche que la première version par défaut, et Résultats ne mesure aucune réponse. | P1 |
| E-03 | **Le client ne voit pas ce qu'il achète** : une entreprise gardée (payée) n'affiche ni site, ni téléphone, ni activité ; pour décider « Garder » (= payer) dans « À vérifier », il doit chercher l'entreprise ailleurs. | P1 |
| R-01 | **« Résultats » ne contient aucun résultat** au sens du client (réponses, rendez-vous) ; l'écran ne dit même pas où arrivent les réponses. | P1 |
| L-01 | **Plus rien ne dit quelle campagne attend le client** : le tableau « Vos prochaines actions » a été retiré le 10/11 et la liste n'affiche ni les formulaires à vérifier, ni les pauses faute de crédits. | P1 |
| M-02 | **Le message tapé se perd sans prévenir** si on clique sur une autre étape ou sur « Modifier l'expéditeur ». | P1 |
| E-05 | **Aucun retour en arrière** : un « Écarter » par erreur fait disparaître l'entreprise pour toujours, un « Garder » par erreur est payé pour toujours. | P1 |
| T-02 | **Les anciens noms d'étapes traînent dans les textes** (« étape Cibler », « Aller à Trouver », « étape Rédiger », « étape Contacter ») alors que les onglets s'appellent Qui ? / Vos entreprises / Votre message / Envoi. | P1 |
| S-01 | **Petite campagne jamais contactable** : si la recherche s'arrête avant 300 entreprises triées, le prix n'est jamais fixé, donc aucune gardée n'est payée ni contactable. Le client voit des « Gardées » mais l'Envoi lui dit qu'il n'y a personne. | P0 |
| S-08 | **Le pilote s'arrête trop tôt** : lancé pendant la recherche (ce que le parcours encourage), il se déclare « Terminé » dès qu'il a rattrapé le tri, alors que d'autres gardées arrivent ensuite. | P0 |
| S-02 | **Des gardées restent bloquées après une panne de crédits** : ni « Reprendre » ni l'achat d'un pack ne les payent ; elles ne seront jamais contactées. | P0 |
| E-12 | **« Mettre en pause » n'arrête pas l'envoi** : la pause de « Vos entreprises » ne concerne que la recherche ; le pilote continue d'envoyer, même pendant une pause « plus de crédits ». | P1 |

### Le fond du problème, en trois phrases

Le parcours est bien découpé, mais **il cache les trois choses qui rassurent un client qui paie** : ce que ça coûte, ce
qu'il obtient, et ce qui va partir en son nom. Plusieurs informations clés ont été rangées dans des bulles « i » puis
ces bulles ont été masquées : le ménage du 10/11 a retiré du bruit, mais aussi ces repères. Enfin, des réglages hérités
du premier usage (entreprises mal notées) s'appliquent encore en silence à toutes les campagnes. Et trois règles en
coulisses (prix mesuré sur 300 entreprises, paiement après une panne de crédits, fin du pilote) font qu'une partie
des entreprises payées peut ne jamais être contactée, sans que l'écran puisse l'expliquer.

---

## 2. Le parcours tel qu'il existe aujourd'hui

```
Barre latérale : Campagnes · Formulaires · Prospects · (Réglages : Expéditeurs, Membres, Dossiers, Facturation)

Campagnes (liste)
  └─ « Nouvelle campagne »
        └─ Écran de création « Qui ? » (une seule longue page)
              1. Qui voulez-vous contacter ?  (phrase + puces + « On cherchera » + Votre offre)
              2. Où ?                         (pays, tout le pays / autour d'une ville / villes précises)
              3. Plus de critères             (fermé : note, avis, site, exclusions)
              4. Nom de la campagne (+ dossier client s'il y en a plusieurs)
              5. [Lancer la recherche]  « Vous ne payez que les entreprises gardées. »
                    │
                    ▼  (la recherche démarre tout de suite)
Page de la campagne : rail  1·Qui ?  2·Vos entreprises  3·Votre message  4·Envoi  5·Résultats
  ├─ Qui ?            résumé en lecture seule + « Modifier le ciblage » (→ page séparée, hors rail)
  ├─ Vos entreprises  barres Recherche + Tri, encart des groupes, onglets Gardées / À vérifier, « Suivant : le message »
  ├─ Votre message    versions A-D, Proposer avec l'IA, Insérer variables, version courte ; à droite :
  │                   expéditeur + aperçu + « Suivant : l'envoi »
  ├─ Envoi            Pilote automatique (défaut) | Avancé
  │     Pilote : « Combien d'entreprises ? » (500 par défaut) + Réglages (quand, expéditeur, messages) → [Lancer]
  │              puis suivi : Envoyés / En cours / Mis de côté / Avancement + fil « En direct » + Pause
  │     Avancé : tableau des formulaires par statut (À valider, Validés, Envoyés, À vérifier, Mis de côté),
  │              Réglages (par jour, validation auto, expéditeur), « Préparer les formulaires »
  └─ Résultats        Contactées / À vérifier / Pas encore contactées / Avancement (+ par groupe ou par version)

En-tête de la campagne : Dupliquer · Exporter · Archiver
```

**Ce qui se passe en coulisses, et combien de temps ça prend** (ce que le client ne voit presque jamais) :

| Étape en coulisses | Durée réelle mesurée | Ce que l'écran en dit |
|---|---|---|
| Recherche des fiches (villes × activités, grandes villes d'abord) | jusqu'à ~7 000 fiches/h ; « tout le pays » = des jours | « 1 234 recherches faites sur 180 000 » + % (souvent « 0,7 % ») |
| Fiches venues de l'annuaire commun | arrivent au compte-gouttes (min. ~3 min) | rien |
| Tri IA de chaque fiche | ~2 s par fiche, au fil de l'eau | barre « Tri x / y triées » |
| Mesure du prix (≈ 300 premières fiches triées) | quelques minutes à quelques heures | rien (bulle masquée) |
| Groupes proposés (après ~100 gardées) | plus tard dans la campagne | encart qui apparaît |
| Préparation d'un formulaire | ~7 min (médiane, file comprise) | rien avant le lancement |
| Envoi, heures de bureau | lun-ven 9 h-18 h, heure des entreprises | « prochain envoi lundi… » |
| Plafond proxy du jour atteint | recherche à l'arrêt jusqu'à minuit (Paris) | rien : le statut reste « En cours » |

---

## 3. Les personnes qui vivent ce parcours

Pour juger chaque écran, quatre situations types :

1. **Première campagne d'un client solo** (le cas le plus fréquent et le plus fragile) : il veut voir vite que « ça
   marche », a peur de spammer, regarde ses crédits. Il ne lit pas les textes longs.
2. **Agence qui prospecte pour plusieurs clients** (dossiers clients) : plusieurs campagnes en parallèle, a besoin de
   savoir laquelle demande son attention, et de rendre des comptes à son client (export, chiffres).
3. **Utilisateur régulier** (comme Studio Namma) : grosses campagnes (30 000+ fiches), groupes, plusieurs messages.
   Veut contrôler le coût et la qualité du tri à grande échelle.
4. **Campagne qui se passe mal** : cible trop vague ou trop précise, plus de crédits, pas de formulaires, site
   injoignable. C'est là que l'UX se juge vraiment.

---

## 4. Écran par écran

### 4.0 Entrée : la liste des campagnes

**Ce que voit le client** : titre « Campagnes », bouton « Nouvelle campagne », recherche, filtres de statut
(Toutes / En cours / En pause / Brouillon / Recherche terminée / Archivée), puis un tableau : nom, statut, dossier
(si plusieurs), pays, prospects trouvés, date. Depuis le 10/11, l'accueil de l'organisation redirige ici (plus de
tableau de bord).

**États** : aucune campagne (panneau vide avec « Ciblez / Trouvez / Contactez ») · liste · filtre sans résultat ·
bandeau « Choisissez un forfait » si pas de forfait (au-dessus de toutes les pages).

| ID | Gravité | Constat | Pourquoi c'est un problème | Recommandation |
|---|---|---|---|---|
| L-01 | P1 | La liste ne dit pas **ce qui attend le client** : formulaires à vérifier, pause faute de crédits, cible trop difficile, pilote en pause, message manquant. Le tableau « Vos prochaines actions » a été retiré le 10/11 ; sa logique existe toujours dans le code mais n'est plus affichée nulle part. | Avec 3 campagnes ou plus (cas agence), il faut ouvrir chaque campagne pour savoir laquelle est bloquée. Une campagne arrêtée faute de crédits peut dormir des jours. | Ajouter une colonne « À faire » (ex. « Plus de crédits · Voir mon forfait », « 12 envois à confirmer », « Envoi en cours 230/500 ») et trier la liste par urgence. La logique existe déjà. |
| L-02 | P1 | La colonne chiffrée est **« Prospects trouvés »** = fiches trouvées avant le tri. | Depuis le crédit unique, ce qui compte pour le client est « gardées » (ce qu'il paie) et « contactées » (ce qu'il obtient). « 36 764 prospects » alors que 7 535 sont gardés induit en erreur. | Remplacer par « Gardées » et « Contactées ». |
| L-03 | P2 | Le **statut** ne décrit que la recherche (« En cours », « Recherche terminée »…). | Une campagne dont la recherche est finie mais qui envoie encore apparaît « Recherche terminée » ; une campagne « En cours » peut n'avoir rien envoyé. | Statut vu du client : « À lancer », « Recherche en cours », « Message à écrire », « Envoi en cours », « En pause – crédits », « Terminée ». |
| L-04 | P2 | Le panneau vide parle de l'**ancien parcours** : « Choisissez une zone géographique et un secteur d'activité », « Une zone, un secteur, des critères », « avec site, téléphone et note moyenne ». | Le premier écran que voit un nouveau client décrit autre chose que ce qu'il va faire (une phrase « Qui voulez-vous contacter ? »). | Réécrire : « Décrivez qui vous voulez contacter, Prospectigo trouve ces entreprises, les trie et leur écrit pour vous. » |
| L-05 | P2 | Sans forfait, le client peut remplir toute la création ; il découvre le blocage **après** « Lancer la recherche », par le message « vous n'avez **plus** de crédits ». | Message faux pour un nouveau client (il n'en a jamais eu) et frustration après l'effort. | Dans la création, si pas de forfait : bouton « Choisir un forfait pour lancer » et dire « votre campagne est gardée ». Corriger « plus de » → « pas de ». |
| L-06 | P3 | Pas de premier pas guidé (onboarding brainstormé le 2/11, en attente). | Le client solo arrive sur une liste vide avec un seul bouton. | Hors périmètre de ce document ; à reprendre avec l'onboarding. |

Preuves : `campaigns/page.tsx` (colonnes, panneau vide), `_lib/next-action.ts` (plus importé nulle part),
`home/[account]/page.tsx` (redirection), `fr/campaigns.json` `list.*`, `launchErrors.noCredits`.

---

### 4.1 Écran de création « Qui ? »

**Ce que voit le client, dans l'ordre** :
1. Carte « Qui voulez-vous contacter ? » : une zone de texte (« Par exemple : agences marketing »). ~1 s après la
   frappe : des **puces** de précision (« + sans celles qui font du web ») qui ajoutent/retirent un bout de phrase,
   et **« On cherchera »** : les activités proposées par l'IA (modifiables, catalogue « Parcourir les activités »).
   Puis **« Votre offre »** (champ, ou une ligne « Trié selon votre offre : … · Modifier » si le dossier en a déjà une).
2. Carte « Où ? » : pays, puis « Tout le pays » (+ habitants minimum) / « Autour d'une ville » (+ rayon) /
   « Villes précises » (+ « alentours »).
3. Pli « Plus de critères » **fermé** : note minimale, note maximale, avis minimum, site web, exclure administrations…,
   mots à exclure, activité principale.
4. Carte : nom de la campagne (rempli tout seul avec la phrase), dossier client (s'il y en a plusieurs).
5. « Lancer la recherche » + « Vous ne payez que les entreprises gardées. »

**États** : vide · l'IA réfléchit (« Mise à jour… ») · puces et activités proposées · erreurs de champ (phrase vide,
offre vide, aucune activité, aucune ville) · erreur serveur · en cours de lancement · lancé (→ « Vos entreprises ») ·
lancé avec erreur (→ « Vos entreprises » + bandeau rouge).

| ID | Gravité | Constat | Pourquoi c'est un problème | Recommandation |
|---|---|---|---|---|
| Q-01 | **P0** | **Critères par défaut très restrictifs et invisibles** : note **entre 1 et 3,5**, au moins **1 avis**, **avec site**, activité principale seulement, administrations/banques/chaînes exclues. Les entreprises **sans note** sont aussi exclues (note minimale 1). Le pli est fermé ; rien ne le signale. Les robots appliquent bien ces filtres. | Hérité du premier usage (entreprises qui ont besoin d'aide sur leurs avis). Pour toute autre cible (« agences marketing », « cabinets d'expertise comptable »), on écarte **avant même le tri** la majorité des entreprises sérieuses (souvent notées 4,5+). Le client croit que Prospectigo « ne trouve pas grand-chose », le prix par gardée peut monter, la campagne peut tomber en « cible trop difficile ». | Défaut neutre : note 1 à 5, sans note acceptée, 0 avis minimum. Garder « avec site » (indispensable pour un formulaire) mais l'afficher. Quand un critère s'écarte du neutre, l'écrire en clair sous « Où ? » : « Seulement les entreprises notées 3,5 ou moins · Modifier ». **Question à Gabriel** : le 3,5 est-il voulu pour l'offre Booster ? Si oui, il doit venir de la phrase/offre, pas d'un défaut global. |
| Q-02 | P1 | **Tout dépend de l'IA pour les activités** : aucune n'est présélectionnée. Si l'IA ne répond pas (panne, phrase de moins de 3 lettres, phrase sans activité évidente), « On cherchera » reste vide **sans aucun message** ; l'erreur « Ajoutez au moins une activité » n'arrive qu'au clic sur « Lancer ». | Le client ne comprend pas pourquoi rien ne se passe, ni qu'il doit aller dans le catalogue. | Si l'IA échoue ou ne propose rien : une ligne « Pas de proposition pour cette phrase : choisissez dans le catalogue » avec le bouton à côté. |
| Q-03 | P1 | **La liste d'activités peut changer sous les yeux** : tant que le client n'a pas touché la liste, chaque nouvelle phrase (ou puce cliquée) remplace les activités proposées. | Il ajoute « sans celles qui font du web », et les activités changent sans qu'il l'ait demandé. | Garder le remplacement, mais l'annoncer (« Activités mises à jour d'après votre phrase ») ou figer après la 1re proposition. |
| Q-04 | P1 | **Changer l'offre ne relance pas le tri.** Seule la phrase relance un tri complet. Or l'offre sert à trier (« les entreprises qui n'en ont pas besoin sont écartées », texte visible). Aucun avertissement. | Le client corrige son offre pour améliorer le tri et ne voit aucun effet. | Soit relancer le tri aussi quand l'offre change (même avertissement que pour la phrase), soit dire « Votre nouvelle offre s'appliquera aux prochaines entreprises triées ». |
| Q-05 | P1 | **Effet de bord sur l'offre** : si le dossier n'a pas encore d'offre, celle tapée dans la campagne devient l'offre du dossier (donc de toutes les campagnes suivantes). | Une agence qui prospecte pour un client avec une offre ponctuelle la retrouve partout. | Le dire sous le champ : « Elle sera aussi proposée pour vos prochaines campagnes. » |
| Q-06 | P1 | **« Où ? » = tout le pays, toutes les villes par défaut.** C'est des dizaines de milliers de villes × N activités. La barre affiche « 0,7 % » pendant des jours. | Le client ne sait pas si c'est normal, ni combien de temps attendre, ni combien d'entreprises espérer. | Garder le défaut (grandes villes d'abord) mais l'expliquer en une ligne visible au lancement et sur « Vos entreprises » : « On commence par les grandes villes ; les premières entreprises arrivent en quelques minutes. » |
| Q-07 | P2 | **Pas de récapitulatif avant le lancement.** Les textes d'un « Résumé de la campagne » existent mais ne sont plus affichés. | Le client lance sans revoir l'ensemble (surtout les critères cachés, cf. Q-01). | Une ligne de résumé au-dessus du bouton : « Agences marketing · France entière · 12 activités · notes 1 à 5 ». |
| Q-08 | P2 | Le **bouton « Lancer » est tout en bas**, après 4 cartes, dont le nom de la campagne placé **après** les critères. | Ordre peu naturel : le nom est une formalité (déjà rempli tout seul), il pousse le bouton plus bas. | Mettre le nom dans l'en-tête (modifiable en ligne) ou juste au-dessus du bouton, en petit. |
| Q-09 | **P0** | **Aucun plafond de dépense par campagne.** « Lancer la recherche » démarre une recherche qui débite chaque entreprise gardée jusqu'à épuisement du solde. Le prix (1, 2 ou 4 crédits) n'est pas connu au lancement. Seule phrase : « Vous ne payez que les entreprises gardées. » | Un client avec 15 000 crédits peut tout dépenser sur une première campagne « tout le pays » pendant la nuit, sans l'avoir décidé. C'est la première source de litiges et de remboursements. | Champ « Arrêter à N entreprises gardées » (défaut proposé : 500 à la 1re campagne) et rappel du solde : « Vous avez 15 000 crédits. Prix mesuré sur les premières entreprises : 1 à 4 crédits chacune. » **Question à Gabriel.** |
| Q-10 | P2 | **Erreur de lancement** : la campagne est enregistrée mais pas lancée ; le bandeau rouge vient de l'adresse (`?erreur=`) et **reste** même après correction et rechargement. Le texte dit « cliquez sur « Modifier » » alors qu'il y a plusieurs « Modifier » à l'écran. | Bandeau qui ment après coup ; bouton à chercher. | Effacer l'erreur de l'adresse une fois affichée ; mettre le bouton d'action dans le bandeau. |
| Q-11 | P3 | Le nom suit la phrase (80 caractères) tant qu'on ne l'a pas touché. Bien. Mais une phrase longue donne un nom long dans la liste. | Liste moins lisible. | Couper au premier signe de ponctuation (« Agences marketing, sans celles… » → « Agences marketing »). |
| Q-12 | P3 | « Votre offre » n'est demandée qu'à la première campagne d'un dossier ; ensuite c'est une ligne discrète. | Bien. Rien à changer, sinon Q-04/Q-05. | — |

Preuves : `campaign-form.tsx` (valeurs par défaut : `ratingMin: 1`, `ratingMax: 3.5`, `minReviews: 1`,
`website: 'with'`, `excludePublic`, `mainCategoryOnly`), `workers/.../discovery/runner.py` l. 459-491 (filtres
appliqués, sans note exclue si note min > 0), `who-section.tsx` (`useSuggestedCategories`, pas de message d'échec),
`campaign-lifecycle-actions.ts` `saveOfferAndTarget` (offre → pas de nouveau tri ; offre recopiée dans le dossier),
`fr/campaigns.json` `form.recap.*` (non utilisés).

#### 4.1 bis Onglet « Qui ? » d'une campagne existante et page « Modifier »

- Résumé en lecture seule (phrase, où, quelles activités, critères), boutons « Modifier le ciblage » et « Vos entreprises ».
- « Modifier » ouvre une **page séparée** (`/edit`), sans le rail des étapes, sans bouton « Annuler » ni « Retour ».

| ID | Gravité | Constat | Recommandation |
|---|---|---|---|
| Q-13 | P2 | L'**offre** n'apparaît pas dans le résumé alors qu'elle trie les entreprises. | L'ajouter (« Trié selon votre offre : … »). |
| Q-14 | P2 | La page « Modifier » sort du parcours : plus de rail, pas d'annulation. Pour revenir sans enregistrer, seul le bouton Retour du navigateur marche. | Garder le rail, ajouter « Annuler ». Idéalement, modifier sur place dans l'onglet « Qui ? ». |
| Q-15 | P2 | Sur une campagne lancée, l'explication de ce que change une modification (« les villes ajoutées rejoignent la recherche… ») est dans une bulle masquée sur l'onglet Qui ?, mais visible sur la page Modifier. Changer la **phrase** affiche « toutes les entreprises déjà trouvées seront triées à nouveau » (sous le bouton seulement). | Le dire **avant** l'enregistrement dans une petite fenêtre de confirmation, avec ce que ça implique pour les entreprises déjà payées et déjà contactées (voir §5). |
| Q-16 | P3 | Le bouton suivant s'appelle « Vos entreprises » ici, « Suivant : le message » ailleurs, « Suivant : l'envoi » ailleurs. | Un seul modèle : « Suivant : vos entreprises ». |

---

### 4.2 « Vos entreprises »

**Ce que voit le client** : carte « Vos entreprises » + badge de statut, la phrase cible « · Modifier », un bouton
Pause/Reprendre (de la **recherche**), deux barres (« Recherche : N recherches faites sur M » et « Tri : x / y triées »),
l'encart des groupes (quand il y en a), deux onglets **Gardées (n)** et **À vérifier (n)**, la liste (50 par 50,
« Afficher plus »), et « Suivant : le message ». Dans « À vérifier » : cases à cocher, « Garder » / « Écarter » par
ligne et en lot. Chaque ligne : nom, ville, groupe (petit), raison du tri.

**États** : lancement en erreur (bandeau rouge) · rien encore (« les premières entreprises triées arrivent dans
quelques minutes ») · recherche en cours · tri en cours · en pause par le client · en pause « plus de crédits »
(bandeau orange) · en pause « cible trop difficile » (bandeau orange) · recherche terminée · liste vide « Aucune
entreprise gardée » · erreur de chargement.

| ID | Gravité | Constat | Pourquoi | Recommandation |
|---|---|---|---|---|
| E-01 | **P0** | **Le prix d'une entreprise gardée est invisible** : « 2 crédits par entreprise gardée » / « Prix en cours de mesure » est dans une bulle « i » ; les bulles sont masquées depuis le 10/11. Le solde n'est pas sur l'écran non plus. | Le CDC (§5.2) demandait cette mention à côté des onglets. Sans elle, le client ne relie pas « gardée » à « payée » et ne sait pas qu'une campagne difficile coûte 4× plus. | Texte visible à côté des onglets : « 2 crédits par entreprise gardée · il vous reste 12 340 crédits ». Pendant la mesure : « Prix mesuré sur les premières entreprises (1 à 4 crédits) ». |
| E-02 | P1 | **Pas de compteur « cette campagne a coûté N crédits ».** | Impossible de faire le lien entre la campagne et la baisse du solde ; impossible pour une agence de refacturer. | Ligne « Crédits utilisés par cette campagne : 3 260 ». |
| E-03 | P1 | **Une ligne = nom, ville, groupe, raison.** Pas de site (lien), pas d'activité, pas de téléphone, pas de note, pas d'ouverture de fiche. | Dans « À vérifier », décider « Garder » (= payer) sans voir le site oblige à chercher ailleurs. Dans « Gardées », le client ne voit pas ce qu'il a acheté ; le CDC (§5.1) prévoyait « le client la voit, avec son téléphone et son site ». | Ajouter le site cliquable et l'activité sur la ligne ; clic sur la ligne = fiche complète (le panneau de fiche existe déjà sur la page Prospects). |
| E-04 | P1 | **« Garder » ne dit pas qu'il coûte.** Pas de confirmation sur « Garder » en lot (50 sélectionnées = jusqu'à 200 crédits). | Dépense sans le savoir. | « Garder (2 crédits) » ; en lot : « Garder 50 entreprises · 100 crédits ». |
| E-05 | P1 | **Aucun retour en arrière.** Un « Écarter » fait disparaître l'entreprise pour toujours (pas d'onglet Écartées, pas d'« Annuler »). Un « Garder » est définitif (pas de bouton dans Gardées). ⚖️ touche la décision du 9/11 (pas d'onglet Écartées, pas d'Écarter dans Gardées). | Une erreur de clic est irréversible, en argent ou en prospects perdus. | Compatible avec la décision : un « Annuler » de quelques secondes dans le message de confirmation (avant que le choix soit définitif). |
| E-06 | P1 | **Liste sans recherche, sans filtre, sans tri** (ville, groupe, raison) ; 50 lignes à la fois. | Avec 7 535 gardées, vérifier la qualité du tri ou retrouver une entreprise est impossible. | Recherche par nom, filtre par groupe et par ville. |
| E-07 | P1 | **Les barres parlent la langue de la machine** : « 1 234 recherches faites sur 180 000 » (une « recherche » = une ville × une activité). Le chiffre parlant (fiches examinées) a été retiré le 10/11. Ni durée, ni rythme. | Le client ne sait ni combien de temps attendre, ni s'il doit s'inquiéter. | Une phrase : « 12 400 entreprises examinées · 2 230 gardées (18 %) · on continue sur les villes plus petites ». Garder une seule barre. |
| E-08 | P1 | **Le taux de garde n'est jamais affiché** alors qu'il fixe le prix (25 % → 1 crédit, 12-25 % → 2, 6-12 % → 4) et déclenche la pause sous 6 %. | La pause « cible trop difficile » tombe sans prévenir. | Afficher le % gardé dès les premières fiches, avec un signal quand il approche de 6 %. |
| E-09 | P1 | **Pause « cible trop difficile »** : le texte renvoie à « l'étape Cibler » (qui s'appelle « Qui ? »), ne dit pas quoi changer, et après modification il faut encore cliquer « Reprendre » (une campagne en pause n'est pas relancée par la modification). | Le client ne sait pas comment s'en sortir. | Dans le bandeau : 2-3 exemples de raisons d'écart les plus fréquentes (« 63 % : ne font pas de marketing ») + « Élargir la cible » + reprise automatique après modification. |
| E-10 | P1 | **Pause « plus de crédits »** : lien « Voir mon forfait », puis il faut revenir et cliquer « Reprendre ». Aucun retour automatique après paiement. | Étape oubliée, campagne qui dort. | Reprise automatique après achat (ou bouton « Reprendre » sur la page de paiement réussi). Et e-mail au client (voir T-06). |
| E-11 | P1 | **Recherche à l'arrêt sans le dire** : quand le plafond proxy du jour est atteint, la recherche attend minuit (Paris) mais l'écran affiche « En cours » avec la roue qui tourne (roadmap n°19 notée, pas faite). | Le client croit que l'outil est cassé. | « En pause jusqu'à minuit (volume du jour atteint) » — sans parler de proxy. |
| E-12 | P1 | **Deux « pause » différentes** : le bouton de cette carte met en pause la **recherche** seulement ; le tri et **le pilote continuent d'envoyer** (vérifié, §5.4), y compris pendant les pauses « plus de crédits » et « cible trop difficile ». Le pilote a sa propre pause dans l'Envoi. | « J'ai mis en pause » mais des messages partent encore. | Libellés explicites : « Mettre la recherche en pause » / « Mettre l'envoi en pause », et une pause « tout arrêter » dans l'en-tête de la campagne. |
| E-13 | P2 | **Encart des groupes** : il n'apparaît qu'après ~100 gardées et si au moins 2 groupes pèsent assez. Il peut donc arriver **après** que le client a écrit son message et lancé l'envoi, sur un écran qu'il ne regarde plus. Choisir « Un message par groupe » change la structure de l'écran Message (l'ancien message devient « Pour les autres »), sans le dire. | Choix découvert tard ou jamais ; effet surprenant sur les messages. | Quand les groupes apparaissent après le lancement de l'envoi : un rappel aussi dans l'Envoi. Dans l'encart, une ligne : « Votre message actuel servira pour les entreprises hors groupes ». |
| E-14 | P2 | **Raisons « site injoignable »** (≈13 % des fiches) atterrissent dans « À vérifier ». | Le client doit trancher des fiches dont même Prospectigo n'a rien pu lire. | Les regrouper (« 45 sites injoignables ») avec une action en lot, ou les retenter automatiquement. |
| E-15 | P2 | **« Déjà contactée » n'existe pas** : une entreprise déjà contactée par l'équipe dans une autre campagne est exclue sans être montrée (CDC §5.1 prévoyait de l'afficher, sans débit). | Le client voit moins d'entreprises sans savoir pourquoi. | Compteur discret : « 120 déjà contactées dans vos autres campagnes (non facturées) ». |
| E-16 | P3 | Le compteur « Mis à jour » rafraîchit toutes les 5-10 s ; la liste se relit toute seule pendant la recherche. Bien. Mais la liste peut « sauter » pendant qu'on coche des cases. | Clics à côté. | Ne pas relire la liste tant qu'une sélection est en cours, ou afficher « 23 nouvelles · Afficher ». |

Preuves : `companies-step.tsx` (InfoTip du prix, `CompanyRow`, pas de recherche/filtre, `PauseAlerts`),
`info-tip.tsx` (`SHOW_INFO_TIPS = false`), `fr/campaigns.json` `detail.tooHardDescription` (« étape Cibler »),
`campaign-groups.tsx` (`shouldPropose` : 2 groupes ≥ 15 %, ou ≥ 2 % au-delà de 5 groupes).

---

### 4.3 « Votre message »

**Ce que voit le client** : à gauche, carte « Votre message » ; onglets de groupes (si « Un message par groupe »),
onglets « Version A · Version B · + » (jusqu'à 4), « Proposer avec l'IA » (campagnes triées), champs Objet / Texte du
message (compteur) / « Insérer : Entreprise · Ville · Activité · (Groupe) · Autres » / « Version courte (facultative) » /
Nom du message ; bouton « Enregistrer les messages ». À droite : « Qui envoie ? » (expéditeur, « Modifier
l'expéditeur », choix s'il y en a plusieurs), « Aperçu · nom d'une entreprise » (« Autre »), et « Suivant : l'envoi ».

**États** : aucun expéditeur (bandeau orange) · aucune entreprise gardée (aperçu « s'affichera dès les premières
entreprises gardées ») · texte vide · proposition IA en cours / proposée (« Annuler ») / quota atteint / IA
indisponible · société non mentionnée (alerte + bouton) · variable inconnue · nom en double · enregistrement OK/échec.

| ID | Gravité | Constat | Pourquoi | Recommandation |
|---|---|---|---|---|
| M-01 | P1 | **Le test A/B ne tient pas sa promesse.** L'écran affiche d'office « Version A » et « Version B » et l'explication (masquée) dit « envoyées à tour de rôle pour voir laquelle marche le mieux ». Mais : (a) dans l'Envoi, **seule la 1re version est cochée par défaut** (sauf mode par groupe) ; la B ne part que si le client ouvre la fenêtre « Messages » des Réglages et la coche ; (b) Résultats ne compte aucune réponse, donc rien ne dit laquelle « marche le mieux ». | Le client écrit une version B qui ne part jamais, ou croit comparer alors qu'on ne mesure que le nombre d'envois. | Cocher toutes les versions écrites par défaut. Tant que les réponses ne sont pas suivies : n'afficher qu'une version (« + Ajouter une version » discret) et ne pas promettre de comparaison. |
| M-02 | P1 | **Perte du texte sans prévenir.** Aucun avertissement en quittant : clic sur une autre étape du rail, sur « Modifier l'expéditeur » ou sur un lien de la barre latérale = texte perdu. Seuls « Enregistrer les messages » et « Suivant : l'envoi » enregistrent. | Le pire moment pour perdre du travail : le client vient d'écrire. | Enregistrement automatique (brouillon) ou fenêtre « Vous avez des changements non enregistrés ». |
| M-03 | P1 | **Deux boutons d'enregistrement à deux endroits** : « Enregistrer les messages » (contour, sous l'éditeur à gauche) et « Suivant : l'envoi » (plein, en bas de la colonne de droite, sous l'aperçu). | On ne sait pas lequel utiliser ; le principal est loin du texte. | Un seul bouton principal « Enregistrer et continuer », sous l'éditeur. |
| M-04 | P2 | **Aperçu = fiche schématique** (Nom, Société, E-mail, Téléphone, Objet, Message), pas un vrai formulaire. Il ne montre pas quand la version courte serait utilisée, ni les champs que les sites demandent souvent (sujet absent, message limité). | Le client croit voir ce qui part. | Le titre « Aperçu de ce que vous écrivez » plutôt que « Aperçu » ; et montrer de vraies captures ailleurs (voir V-01). |
| M-05 | P2 | **« Version courte (facultative) »** toujours affichée, dans un encadré pointillé, sous chaque version. Son explication (« certains sites limitent la longueur… ») est dans une bulle masquée. Que se passe-t-il si elle est vide sur un site limité ? L'écran ne le dit pas. | Champ mystérieux qui double l'effort. | La générer automatiquement à partir du message (proposée, modifiable) ; ou une ligne visible : « Utilisée quand le site limite le message à 200 caractères ». |
| M-06 | P2 | **« Nom du message »** en bas de chaque version. C'est pourtant ce nom qui identifie le message dans l'Envoi : le renommer pendant que le pilote tourne provoque « Un message coché n'existe plus : rechargez la page ». | Champ inutile pour 95 % des clients, et piège pour les autres. | Nom automatique (« Version A »), modifiable seulement dans un menu. Les messages devraient être suivis par un identifiant, pas par leur nom. |
| M-07 | P2 | **Phrases qui disparaissent** : si une info manque (pas de ville, pas de note), « la phrase qui la contient est retirée ». La règle est dans une bulle masquée. | Dans l'aperçu, une phrase s'évapore sans explication. | Dans l'aperçu, signaler « 1 phrase retirée pour cette entreprise (ville inconnue) ». |
| M-08 | P2 | **Exemples hérités de l'ancien usage** : objet « Exemple : Vos avis clients », message « Nous avons regardé la présence en ligne de votre entreprise… ». | Oriente le client vers un message hors de son sujet. | Exemples neutres, ou construits à partir de sa cible et de son offre. |
| M-09 | P2 | **L'expéditeur se modifie ailleurs** : « Modifier l'expéditeur » ouvre la page Expéditeurs, hors de la campagne, **sans lien de retour**. L'explication (« les entreprises vous répondront à cet e-mail ») est masquée. | Le client se perd et perd son texte (M-02). | Modifier l'expéditeur dans une fenêtre, sur place. Rendre visible la phrase sur les réponses : c'est la seule promesse « où arrivent les réponses ». |
| M-10 | P2 | **« Pour les autres » vide en mode groupes** : les entreprises hors groupes reçoivent le message d'un **autre** groupe (texte visible, en gris). | Si ce message cite le métier du groupe (« {groupe} » ou en dur), il part chez la mauvaise entreprise. | Bloquer le lancement tant que « Pour les autres » est vide, ou dire clairement « elles ne seront pas contactées ». |
| M-11 | P3 | « Proposer avec l'IA » remplace la version ouverte ; « Annuler » possible tant qu'on n'a rien retouché. Le quota (30/jour) ne s'affiche qu'après le 1er clic. | Correct. | Rien, sinon afficher le quota sur le bouton quand il reste moins de 5. |
| M-12 | P3 | En mode groupes : deux rangées d'onglets (groupes puis versions), plus les variables. | Écran dense. | Une liste de groupes à gauche, l'éditeur à droite. |

Preuves : `campaign-messages-form.tsx` (pas de garde de sortie, `counts` min. 2 versions, deux boutons),
`contact-autopilot.tsx` `defaultValues.messages` (`slice(0, 1)` hors groupes), `results-step.tsx` (pas de réponses),
`fr/outreach.json` `messages.subjectPlaceholder` / `bodyPlaceholder`, `fr/campaigns.json` `messages.othersEmpty`.

---

### 4.4 « Envoi »

#### Pilote automatique (mode par défaut)

**Ce que voit le client** : sélecteur « Pilote automatique | Avancé » ; à gauche « Combien d'entreprises voulez-vous
contacter ? » (−/+ par 50, champ, puces 100/250/500/1000/« Tous (N) »), bouton « Lancer le pilote automatique » ; à
droite un panneau « Réglages » : « Quand envoyer ? » (Heures de bureau / Étalé sur N jours ouvrés / En continu),
« Qui envoie ? » (lien Modifier), « Messages » (résumé + fenêtre à cases à cocher). Au-dessus, des bandeaux si
pas de prospects / pas de message / pas d'expéditeur.

Puis, une fois lancé : point vert « Pilote automatique en marche », Pause / Modifier le nombre, éventuellement « Hors
des heures de bureau : prochain envoi lundi 9 h (heure de Paris) », bande de chiffres Envoyés x/y · En cours · Mis de
côté · Avancement, fil « En direct ». À la fin : « Terminé : N entreprises contactées » + « Contacter d'autres
entreprises ».

**États** : bloqué (pas de forfait / plus personne à contacter) · réglage · aperçu des 3 premiers (option masquée) ·
en marche · en attente d'heures de bureau · en pause · sans forfait (« le pilote attend ») · terminé · terminé faute
de prospects · modification en cours.

| ID | Gravité | Constat | Pourquoi | Recommandation |
|---|---|---|---|---|
| V-01 | **P0** | **Lancement irréversible en un clic.** « Lancer le pilote automatique » part directement, avec **500** par défaut (ou « Tous » si moins), sans récapitulatif ni confirmation. L'option « Me montrer les 3 premiers formulaires avant d'envoyer » est masquée depuis le 10/11. Les textes prévus pour rassurer (« Ce qui va se passer », résumé « 1 060 entreprises · 2 versions », « Campagne lancée. Premiers formulaires dans quelques minutes ») existent mais ne sont plus affichés. ⚖️ touche le choix du 10/11 (option d'aperçu masquée). | Un message envoyé en son nom ne se rattrape pas. Le client n'a jamais vu un vrai formulaire rempli. À la 1re campagne, c'est le moment de plus grande peur. | Fenêtre de confirmation : « Vous allez contacter 500 entreprises, au nom de Marie Dupont (Studio X), avec la version A, en heures de bureau. Les premiers envois partent dans ~10 min. » + [Lancer]. **Question à Gabriel** : réactiver l'aperçu des 3 premiers formulaires **par défaut à la 1re campagne seulement** ? |
| V-02 | P1 | **500 par défaut.** | Pour une 1re campagne, c'est beaucoup pour « essayer » ; pour une grosse campagne, c'est arbitraire. | 1re campagne : 50 par défaut. Ensuite : se souvenir du dernier choix. |
| V-03 | P1 | **Le maximum n'est pas expliqué** : la seule trace est la puce « Tous (N) ». N = entreprises gardées pas encore contactées ni préparées ; il grandit tant que la recherche tourne. Le texte qui l'expliquait (« Maximum N… ») n'est plus affiché. | « Pourquoi je ne peux pas mettre 2 000 ? » | Sous le nombre : « 1 230 entreprises gardées pas encore contactées ; d'autres arrivent avec la recherche. » |
| V-04 | P1 | **Messages : voir M-01.** Le panneau affiche « Message 1 » ; il faut ouvrir une fenêtre pour cocher la B. | La version B n'est pas envoyée. | Toutes cochées par défaut ; résumé « 2 versions à tour de rôle ». |
| V-05 | P1 | **Deux modes qui se marchent dessus** : « Prises de contact par jour » et « Validation automatique » se règlent dans **Avancé** et **ne s'appliquent pas au pilote** (la note qui le disait n'est plus affichée). | Le client règle « 50 par jour » dans Avancé en croyant brider le pilote. | Dans le pilote, montrer le rythme réel (« ≈ 60 envois par jour ouvré ») ; dans Avancé, dire « Ces réglages ne concernent pas le pilote automatique ». À terme : un seul jeu de réglages. |
| V-06 | P1 | **« Mis de côté » = entreprises payées qui ne seront pas contactées** (pas de formulaire, captcha, champ inconnu, site injoignable : ≈ 1 sur 2 d'après les mesures). Le chiffre renvoie vers Avancé, onglet « Intervention requise » seulement. Rien ne propose de les contacter autrement. | Le client a payé ces entreprises (1 crédit = 1 entreprise gardée, prise de contact « incluse ») et n'obtient rien. C'est le plus gros écart entre la promesse et le résultat. | Liste « À contacter vous-même » avec téléphone, site et e-mail trouvé, exportable. Dans la promesse commerciale, dire « environ 1 sur 2 a un formulaire utilisable ». |
| V-07 | P1 | **Bandeaux du haut faux ou datés** : « Il manque l'expéditeur » a un bouton **« Rédiger le message »** ; « Aucun prospect… » a un bouton **« Aller à Trouver »** ; ce bandeau se base sur les fiches trouvées et non sur les gardées. | Mauvais bouton, mauvais nom d'étape ; pour une campagne triée avec 0 gardée, pas de bandeau du tout. | « Renseigner l'expéditeur » ; « Voir vos entreprises » ; se baser sur les gardées. |
| V-08 | P1 | **Message trompeur quand rien n'est encore gardé** : si une campagne triée n'a encore aucune gardée, le pilote affiche « Tous les prospects de cette campagne ont déjà été contactés ou préparés ». | Faux : il n'y a juste encore personne. | « Aucune entreprise gardée pour l'instant : revenez quand le tri aura avancé » (+ lien vers Vos entreprises). |
| V-09 | P2 | **Fil « En direct »** : clair, une ligne par événement, mais les dernières lignes seulement, tronquées, sans lien vers la capture du formulaire envoyé. | Le client voit « Message envoyé à X » mais ne peut pas voir ce qui est parti. | Clic sur une ligne = capture du formulaire. |
| V-10 | P2 | **« Modifier le nombre »** pendant la marche ré-ouvre le réglage complet (nombre, quand, messages). Le libellé ne le dit pas. | Petite surprise. | « Modifier » tout court. |
| V-11 | P2 | **« Qui envoie ? → Modifier »** sort de la campagne (même problème que M-09). | Perte du fil. | Fenêtre sur place. |
| V-12 | P2 | **Heures de bureau** : le texte promet « heure des entreprises contactées », mais c'est l'heure de la ville ciblée la plus peuplée, pour toute la campagne, sans jours fériés (S-10). | Pour une campagne multi-fuseaux, une partie reçoit les messages la nuit ; texte inexact. | Heure locale par entreprise ; sinon corriger le texte (« heure de Paris »). |

#### Mode Avancé

**Ce que voit le client** : une carte « Formulaires » avec onglets (À valider, Validés en attente, Envoyés, À
vérifier, Mis de côté), « Réglages » en fenêtre (expéditeur, prises de contact par jour, validation automatique),
« Préparer les formulaires » / « Préparer les nouveaux prospects ». Chaque formulaire : capture, message, détail,
actions Valider / Passer / Ne jamais contacter / Bien arrivé / Pas arrivé.

| ID | Gravité | Constat | Recommandation |
|---|---|---|---|
| V-13 | P2 | Le mode Avancé et la page « Formulaires » de la barre latérale montrent la même chose (filtrée ou non). Deux portes, deux mises en page. | Une seule liste, filtrée par campagne quand on vient d'une campagne. |
| V-14 | P2 | Des textes promettent « environ une minute par site » (page Formulaires) alors que la mesure réelle est ~7 min file comprise. | « Les premiers formulaires arrivent en quelques minutes. » Ne jamais promettre une durée par site. |
| V-15 | P2 | Les textes d'aide de la page Formulaires disent encore « étape « Contacter » », « étape « Rédiger » ». | Voir T-02. |

Preuves : `contact-autopilot.tsx` (`SHOW_PREVIEW_OPTION = false`, `Math.min(500, …)`, pas de confirmation,
`messages.slice(0, perGroup ? MAX : 1)`), `contact-step.tsx` (`Hint` noSender → `writeMessage`, `goDiscover`,
`props.prospects === 0`), `fr/campaigns.json` `autopilot.how.*`, `autopilot.maxHint`, `fr/outreach.json`
`sendStep.launchSummary`, `launchedTitle`, `autopilotSettingsNote` (définis, jamais affichés).

---

### 4.5 « Résultats »

**Ce que voit le client** : une bande de 4 chiffres (Contactées · À vérifier · Pas encore contactées · Avancement),
puis, en mode groupes, un tableau par groupe (gardées, contactées, à vérifier, avancement), sinon un tableau par
version (s'il y en a au moins 2). Si rien n'est parti : « Aucune prise de contact n'est encore partie » + « Aller à
l'envoi ».

| ID | Gravité | Constat | Pourquoi | Recommandation |
|---|---|---|---|---|
| R-01 | P1 | **Aucune réponse suivie** (décision du 10/11 : rien ne recueille les réponses ; V1.1). « Résultats » = compteurs d'envois. L'écran **ne dit même pas où arrivent les réponses** (l'e-mail de l'expéditeur est transmis à l'écran mais pas affiché). | Pour un client, le résultat d'une campagne, ce sont des réponses et des rendez-vous. Un écran « Résultats » sans résultat déçoit à chaque visite. | En attendant la V1.1 : (1) une ligne « Les réponses arrivent directement sur marie@studio.fr et au 06… » ; (2) sur chaque entreprise contactée, un bouton « A répondu » / « Intéressé » pour noter à la main ; (3) renommer l'onglet « Suivi » tant qu'il n'y a pas de réponses. |
| R-02 | P1 | **Pas de liste « qui ai-je contacté, quand, avec quel message ».** Les chiffres ne sont pas cliquables (sauf « À vérifier »). | Quand une entreprise rappelle, le client ne retrouve pas ce qu'on lui a envoyé en son nom. | « Contactées » cliquable → liste avec date, version, capture. |
| R-03 | P2 | **« Pas encore contactées » inclut celles qui ne le seront jamais** (sans formulaire, captcha…). L'avancement plafonne donc autour de 50 %. | Impression d'échec ou de travail inachevé. | Séparer « Impossible par formulaire : 640 (à contacter vous-même) ». |
| R-04 | P2 | **« Par version »** ne montre que le nombre d'envois par version. | Ne permet aucune conclusion (voir M-01). | Masquer ce tableau tant qu'il n'y a pas de réponses, ou le présenter comme « répartition des envois ». |
| R-05 | P2 | **« À vérifier »** (envoyé sans confirmation claire) : c'est au client de trancher « Bien arrivé / Pas arrivé » en regardant une capture ; ni pourquoi, ni ce qui se passe s'il ne le fait pas. | Tâche obscure qui traîne. | Une ligne : « Prospectigo a cliqué sur Envoyer sans voir de confirmation. Regardez la capture ; sans réponse de votre part, on les compte comme envoyés. » |

---

## 5. Les règles en coulisses qui changent l'expérience

> Cette partie décrit ce que fait réellement la base et les robots, parce que plusieurs problèmes viennent de règles
> que l'écran ne montre pas.

Préfixes des preuves : `S/` = `apps/web/supabase/schemas/`, `W/` = `workers/leadmaker_workers/`.

### 5.1 Quand le client paie

- **Rien à la découverte.** Une fiche trouvée ne coûte rien. On vérifie seulement qu'il reste du solde ; à 0, la
  fiche est jetée et la campagne passe en pause « plus de crédits » (S/27:910-918).
- **On paie quand l'entreprise devient « gardée »** : par l'IA (S/37:321) ou par le clic « Garder » du client
  (S/38:100-112). « À vérifier » et « écartée » ne coûtent jamais rien.
- **Prix** : mesuré sur les **300 premières entreprises triées** de la cible en cours. Part gardée ≥ 25 % → 1 crédit ;
  ≥ 12 % → 2 ; ≥ 6 % → 4 ; < 6 % → pause « cible trop difficile » (S/37:111-126, 154-183). Une fois mesuré, le prix est
  figé et toutes les gardées en attente sont payées d'un coup.
- **Tant que le prix n'est pas mesuré, aucune gardée n'est payée, donc aucune n'est contactable** (S/37:208 ;
  le pilote exige « payée », S/33:438-439).
- **Débit** : forfait d'abord, puis packs (le plus proche de l'expiration d'abord).

| ID | Gravité | Constat (vérifié dans le code) | Ce que vit le client | Recommandation |
|---|---|---|---|---|
| S-01 | **P0** | **Petite campagne = jamais contactable.** Si la recherche se termine avant 300 entreprises triées (zone ou cible étroite : « plombiers à Annecy »), le prix n'est **jamais** fixé : aucune gardée n'est payée, donc le pilote ne trouve personne. | Il voit des « Gardées » dans l'écran 2, puis l'Envoi lui dit qu'il n'y a personne à contacter (V-08). Aucune explication possible. | Si la recherche est finie (ou après X heures) sous 300 triées : fixer le prix sur ce qui a été trié (ou 1 crédit par défaut). |
| S-02 | **P0** | **Gardées non payées bloquées après une panne de crédits.** Quand le solde tombe à 0, les gardées suivantes restent affichées mais impayées (donc non contactables). Ni « Reprendre » ni l'achat d'un pack ne les règlent ; seul un nouveau « Garder » ou la prochaine gardée par l'IA déclenche un règlement (S/37:225-231, S/38:111). | Il recharge, reprend, et une partie de « ses » gardées ne sera jamais contactée, sans signe visible. | Régler toutes les gardées en attente à la reprise et à chaque achat. |
| S-03 | P1 | **Entreprise déjà dans le dossier = gratuite**, même si elle n'a jamais été payée (écartée ailleurs, import CSV…) : elle est rattachée « payée, 0 crédit » dès qu'elle est trouvée, avant tri (S/27:899-907). | Rien de visible ; fuite de revenu, et l'utilisateur régulier voit des campagnes « moins chères » sans comprendre pourquoi. | Ne marquer « payée » que si elle a réellement été payée dans une autre campagne. |
| S-04 | P1 | **Prix contourné par une ancienne estimation** : une campagne identique (ex. une copie) relancée dans les 7 jours reprend le prix d'une ancienne estimation par filtres, ce qui saute la mesure par le tri et la pause « trop difficile » (S/27:538-551). | Prix incohérent entre deux campagnes identiques. | Ignorer les estimations pour les campagnes avec une phrase cible. |

### 5.2 Changement de cible

- Nouvelle version de tri : toutes les entreprises sont **re-triées**, le prix repasse « à mesurer » sur 300 nouvelles
  (S/37:70-97).
- **Déjà payées** : restent payées, pas de nouveau débit, pas de remboursement. **Anciennes écartées qui deviennent
  gardées** : payées au nouveau prix. **Déjà contactées** : jamais recontactées.
- **Les choix du client restent** : un ancien « Garder » reste gardé, un ancien « Écarter » reste écarté pour toujours,
  quelle que soit la nouvelle cible (S/38:104-105).

| ID | Gravité | Constat | Recommandation |
|---|---|---|---|
| S-05 | P1 | **Pendant le re-tri, l'écran et le pilote ne disent pas la même chose** : l'écran 2 ne compte que la nouvelle version (les anciennes gardées passent « en attente »), mais le pilote continue de contacter les anciennes gardées payées tant qu'elles ne sont pas re-triées, même celles que la nouvelle cible écartera. | Mettre le pilote en pause pendant un re-tri, ou ne contacter que les entreprises triées avec la cible en cours. Le dire dans la confirmation (Q-15). |
| S-06 | P1 | **Les groupes ne sont jamais reproposés après un changement de cible** : ils restent ceux de l'ancienne cible et les nouvelles entreprises y sont rangées (S/37:326). | Remettre les groupes à zéro avec la nouvelle cible. |
| S-07 | P2 | Pendant le re-tri, le prix repasse « à mesurer » : les nouvelles gardées ne sont ni payées ni contactables pendant 300 tris. | Le dire : « Nouvelle cible : on remesure le prix sur les 300 prochaines entreprises. » |

### 5.3 Pilote automatique

- **Qui il contacte** : les entreprises gardées **et payées**, avec un site, hors liste d'opposition, jamais
  contactées par le dossier, **dans l'ordre d'arrivée des fiches** (S/33:432-449).
- **Nombre visé** = plus petit de (choix du client, contactables au lancement).
- **Fin** : quand le nombre est atteint (les « à vérifier » comptent comme envoyés), ou **dès qu'il n'a plus personne à
  contacter et rien en cours — même si la recherche et le tri tournent encore** (S/33:505-519).
- **Messages** : à chaque envoi, le message coché le moins utilisé (donc parts égales) ; en mode groupes, ceux du groupe,
  sinon « Pour les autres », sinon n'importe lequel — **même non coché** si aucun coché ne convient (S/33:454-479).
- **Fuseau** : celui de la ville ciblée la plus peuplée (sinon la plus grande ville du pays), fixé au lancement.
  Heures de bureau : lun-ven 9 h-18 h, **jours fériés non gérés**, pas de limite par jour (S/33:201-298).
- **« Étalé sur N jours »** : quota par jour = objectif ÷ N, calculé sur l'objectif total (pas sur ce qui reste).
- **La limite « prises de contact par jour » ne s'applique pas au pilote**, mais ses envois la consomment pour les
  envois manuels du jour (S/30:110-133).
- **Préparation d'avance** : 12 formulaires au plus en parallèle ; le plafond de 500 formulaires prêts ne concerne pas
  le pilote.

| ID | Gravité | Constat | Ce que vit le client | Recommandation |
|---|---|---|---|---|
| S-08 | **P0** | **Le pilote se termine trop tôt.** Lancé pendant que la recherche tourne (c'est ce que le parcours encourage : message → envoi pendant la recherche), il s'arrête « Terminé, plus aucun prospect à contacter » dès qu'il a rattrapé le tri, alors que de nouvelles gardées arrivent ensuite. | Il a demandé 500, reçoit « Terminé : 37 entreprises contactées » et un e-mail « terminé ». Il doit relancer à la main, encore et encore. | Tant que la recherche ou le tri tournent, le pilote **attend** (« En attente de nouvelles entreprises gardées »). |
| S-09 | P1 | **Entreprises sautées** : le pilote avance avec un curseur sur la date d'arrivée de la fiche. Une entreprise ancienne payée **après** le passage du curseur (« À vérifier » gardée après coup, gardée réglée en retard, doublon) est sautée par ce passage, tout en restant comptée dans « Tous (N) ». | Le compteur promet N, le pilote en contacte moins. | Parcourir par date de paiement, ou repasser sur les oubliées avant de finir. |
| S-10 | P1 | **Fuseau unique** : une campagne multi-pays/multi-fuseaux envoie aux heures de bureau de la plus grande ville seulement. Pas de jours fériés. | Messages à 3 h du matin pour une partie des entreprises, ou un 25 décembre. | Heure locale de chaque entreprise (sa ville est connue), et calendrier des jours fériés par pays. |
| S-11 | P2 | **Message non coché envoyé** en mode groupes si aucun message coché ne convient au groupe. | Il décoche une version, elle part quand même. | Refuser le lancement ou l'avertir quand un groupe n'a aucun message coché. |
| S-12 | P2 | **« Étalé »** : le quota par jour est calculé sur le total ; après une pause ou une modification, le rythme ne se recale pas. | « Sur 5 jours » qui en dure 8. | Calculer sur le reste à envoyer et les jours restants. |

### 5.4 Pauses, archivage, notifications

- **« Mettre en pause » sur « Vos entreprises » arrête seulement la recherche.** Le tri en file continue, **le pilote
  continue d'envoyer**, y compris pendant les pauses « plus de crédits » et « cible trop difficile » (S/27:615-646).
  → confirme et aggrave **E-12** : le client qui veut « tout arrêter » ne le peut pas depuis cet écran.
- **Pause du pilote** : annule préparations et envois en file ; reprise = tout repart.
- **Archivage** : arrête recherche et pilote, retient les envois validés. Cas limite : les formulaires en attente d'un
  pilote annulé restent bloqués pour toujours et occupent le plafond de 500 du dossier.
- **Désarchivage** : la campagne revient en pause ; rien ne repart tout seul.
- **E-mails envoyés au client** (toutes les 5 min, chacun peut couper par thème) : aperçu du pilote prêt, pilote
  terminé, recherche terminée (1/jour ; le chiffre compte aussi les écartées), recherche en pause faute de crédits
  (1/jour/campagne), crédits bas (< 20 % du forfait, packs ignorés).
  **Pas d'e-mail pour** : cible trop difficile, prix fixé, groupes prêts, envois à vérifier, mis de côté, pilote mis
  en pause. → précise **T-06**.

| ID | Gravité | Constat | Recommandation |
|---|---|---|---|
| S-13 | P1 | E-mail « recherche terminée » : le nombre annoncé compte les **écartées**. | Annoncer gardées / contactées. |
| S-14 | P1 | E-mail « pilote terminé » envoyé aussi quand il s'arrête trop tôt (S-08). | Corriger S-08 ; distinguer « objectif atteint » de « en attente ». |
| S-15 | P1 | Pas d'e-mail « cible trop difficile » : la campagne peut dormir sans que le client le sache. | L'ajouter, avec les raisons d'écart principales. |

### 5.5 Groupes, copie, annuaire, limites

- **Groupes** : proposés quand l'IA a gardé **100** entreprises (300 en groupes fins), 2 à 5 groupes (4 à 20 en fins).
  S'il en trouve moins de 2, ils ne seront **plus jamais** proposés pour cette cible. Une « À vérifier » gardée par le
  client avant l'arrivée des groupes n'est jamais classée : elle reçoit le message « Pour les autres ».
- **Dupliquer** copie : pays, ciblage, filtres, offre, messages, expéditeur, rythme. **Ne copie pas la phrase cible**
  (à retaper), ni les groupes, ni le prix. Les messages rangés par groupe gardent des groupes qui n'existent pas dans la
  copie. → précise **T-09** : « Dupliquer » donne un formulaire où la pièce centrale (la phrase) est vide.
- **Annuaire commun** : chaque recherche déjà faite il y a moins de 90 jours est rejouée sans frais ; premières fiches
  après **20 à 40 s**, puis par paquets ; une campagne dure au moins 3 min. Invisible pour le client (voulu).
- **Campagnes en cours simultanées** : limitées par forfait (valeurs de départ 1 / 3 / 10 ; à vérifier en prod).
  Message clair en cas de refus.

| ID | Gravité | Constat | Recommandation |
|---|---|---|---|
| S-16 | P2 | Groupes « jamais reproposés » si le premier essai échoue ; aucune trace pour le client. | Réessayer après 100 gardées de plus. |
| S-17 | P2 | Copie sans phrase cible ; messages par groupe orphelins. | Copier la phrase ; ranger les messages orphelins dans « Pour les autres ». |
| S-18 | P2 | Limite de campagnes en cours : seul le statut « recherche en cours » compte, pas un pilote qui envoie. Une agence peut donc « contourner » en mettant les recherches en pause. | À trancher : c'est peut-être voulu (ce qui coûte, c'est la recherche). |

---

## 6. Points transversaux

| ID | Gravité | Constat | Recommandation |
|---|---|---|---|
| T-01 | P2 | **Rail des étapes** : 5 pastilles numérotées, toutes cliquables à tout moment ; coche pour « fait ». « Qui ? » est toujours coché ; « Résultats » n'est jamais « fait ». Le résumé de l'étape (« 2 340 entreprises gardées ») est une ligne grise sous le rail. Bien. Mais aucune étape ne dit « à faire maintenant ». | Mettre en avant la prochaine étape à faire (point de couleur), pas seulement l'étape ouverte. |
| T-02 | P1 | **Vocabulaire mélangé.** Anciens noms d'étapes encore visibles : « étape Cibler » (pause trop difficile), « Aller à Trouver », « Passer à Rédiger », « (étape Rédiger) » (erreurs du pilote, page Expéditeurs), « étape « Contacter » » (page Formulaires). Et pour la même chose : « prospects » / « entreprises » / « fiches » ; « prises de contact » / « envois » / « messages » / « formulaires ». | Un glossaire de 5 mots, appliqué partout : **entreprise trouvée → gardée → contactée** ; **message** (ce qu'on écrit) ; **formulaire** (où on le dépose). Remplacer tous les anciens noms d'étapes. |
| T-03 | **P0** | **L'argent est invisible dans tout le parcours** : ni solde, ni prix par gardée, ni coût de la campagne, sur aucun des 5 écrans. Le seul endroit est la page Facturation. | Un repère d'argent permanent dans la campagne : « 2 crédits / gardée · 3 260 utilisés · 11 740 restants ». |
| T-04 | P1 | **Aides masquées** : en plus du prix (E-01), sont devenus invisibles : à quoi sert l'expéditeur, comment marchent les versions et les variables, à quoi sert la version courte, ce que change une modification de campagne lancée. ⚖️ touche le choix du 10/11 de masquer les « i ». | Sans rouvrir les « i » : remettre en **texte court visible** les 3 informations qui engagent le client (prix, où arrivent les réponses, ce qui va partir). Le reste peut rester caché. |
| T-05 | P1 | **Sorties du parcours sans retour** : Modifier le ciblage (page sans rail), Modifier l'expéditeur (page Expéditeurs), Voir mon forfait (Facturation). Aucune ne ramène à la campagne. | Fenêtres sur place, ou un lien « ← Revenir à la campagne » quand on vient d'une campagne. |
| T-06 | P1 | **E-mails incomplets** (détail §5.4) : il en existe pour « plus de crédits », « crédits bas », « recherche terminée », « pilote terminé », « aperçu prêt » ; **rien** pour « cible trop difficile », « envois à vérifier », « mis de côté », ni pour le premier retour de valeur (« vos premières entreprises gardées »). | Ajouter « Cible trop difficile » et « Vos premières entreprises sont prêtes » en priorité. |
| T-07 | P1 | **Le temps n'est jamais expliqué** : recherche (heures/jours), tri (minutes), préparation (~7 min), heures de bureau. | Une phrase de délai à chaque étape où l'on attend. |
| T-08 | **P0** | **L'export d'une campagne sort toutes ses fiches**, y compris écartées et « à vérifier » non payées (site, téléphone, adresse…). Le CDC disait : « s'il arrive un export, il ne doit sortir que des fiches payées ». De plus, l'export se base sur la campagne d'origine de la fiche : une entreprise venue d'une autre campagne ou de l'annuaire peut manquer. La page Prospects ne tient pas compte du tri non plus (elle montre aussi les écartées). | Export d'une campagne = entreprises gardées (payées) de cette campagne. Page Prospects : même règle. ⚖️ « écartée = interne seulement » (décision du 9/11) est aujourd'hui contredite par l'export. |
| T-09 | P1 | **Dupliquer** crée un brouillon et ouvre la page Modifier **avec la phrase cible vide** (elle n'est pas copiée, S-17) ; le reste (zone, offre, messages, expéditeur) l'est. Rien ne le dit. | Copier la phrase ; message « Copie créée : tout est repris, lancez-la quand vous voulez ». |
| T-10 | P2 | **Archiver** : fenêtre de confirmation claire (ce qui s'arrête, ce qui reste). Désarchiver remet en pause. Bien. | Rien. |
| T-11 | P2 | **Deux personnes de l'équipe** qui écrivent le message en même temps : le dernier qui enregistre écrase l'autre, sans avertissement. | Plus tard : « Modifié par Nath il y a 2 min ». |
| T-12 | P2 | **Anciennes campagnes sans phrase cible** : elles gardent l'ancien écran de recherche (« Recherche des entreprises », derniers prospects, tarif) dans le même rail. Deux expériences différentes selon l'ancienneté. | Acceptable pour les comptes internes ; à faire disparaître avant les premiers clients. |
| T-13 | P3 | **Mobile** : le rail défile horizontalement, les deux colonnes passent l'une sous l'autre (l'aperçu du message et « Suivant » se retrouvent tout en bas). | Sur mobile, le bouton principal juste sous l'éditeur. |
| T-14 | P3 | **UI** : beaucoup de gris sur gris pour des informations importantes (lignes d'état, raisons du tri, ligne de l'offre) ; les avertissements orange sont, eux, bien visibles. Les écrans Envoi et Résultats (refaits le 10/11) sont les plus lisibles ; « Votre message » est le plus chargé. | Réserver le gris aux détails ; passer en noir les 3 repères qui engagent (prix, nombre, expéditeur). |

---

## 7. Cas limites : tout ce qui peut arriver

Chaque ligne : la situation → ce que vit le client aujourd'hui → ce qu'il faudrait.

### 7.1 Avant et au lancement

| ID | Situation | Aujourd'hui | Il faudrait |
|---|---|---|---|
| C-01 | Nouveau client **sans forfait** remplit tout et clique « Lancer » | Campagne enregistrée en brouillon, arrivée sur « Vos entreprises » vide avec bandeau rouge « vous n'avez **plus** de crédits » | Le savoir avant de remplir (L-05) ; bouton « Choisir un forfait » dans le bandeau ; reprise du lancement après paiement |
| C-02 | Forfait mais **solde à 0** | Même bandeau ; la campagne reste en brouillon | Idem + proposer un pack |
| C-03 | **Limite de campagnes en cours** atteinte | Bandeau « mettez-en une en pause » | Lister les campagnes en cours avec un bouton « Mettre en pause » dans le bandeau |
| C-04 | L'IA ne propose **aucune activité** (panne, phrase bizarre, < 3 lettres) | Rien ne se passe ; erreur seulement au clic | Q-02 |
| C-05 | Phrase **très vague** (« entreprises », « PME ») | Presque tout est gardé → 1 crédit chacune, le solde fond vite | Avertir quand la phrase est trop large (« Précisez le métier ou la taille ») ; plafond Q-09 |
| C-06 | Phrase **très précise** (« agences Webflow de 3 personnes à Lyon ») | 300 triées, < 6 % gardées → pause « trop difficile » au bout de quelques minutes/heures | Montrer le % gardé en direct (E-08), e-mail (S-15) |
| C-07 | Zone **petite** (une ville moyenne, un métier rare) : < 300 entreprises triées | Prix jamais fixé → gardées jamais payées ni contactables (S-01) | Fixer le prix en fin de recherche |
| C-08 | **Aucune entreprise trouvée** | « Recherche terminée sans résultat » n'apparaît plus nulle part depuis la suppression du tableau de bord ; l'écran 2 dit « Aucune entreprise gardée » | Message dédié : « Aucune entreprise trouvée dans cette zone : élargissez la zone ou les activités » |
| C-09 | **Toutes écartées** (cible et activités incohérentes) | Liste vide, puis pause « trop difficile » | Idem C-06, avec les raisons d'écart |
| C-10 | Critère caché **note ≤ 3,5** sur une cible où les entreprises sont bien notées | Peu de fiches, prix plus élevé, ou « trop difficile » | Q-01 |
| C-11 | **Plafond du jour atteint** (volume de recherche) | « En cours » avec roue qui tourne, rien n'arrive jusqu'à minuit | E-11 |
| C-12 | Le client **ferme l'onglet** juste après « Lancer » | Tout continue côté serveur ; e-mails seulement pour certains événements | Bien. Ajouter l'e-mail « vos premières entreprises sont triées » (premier retour de valeur) |

### 7.2 Pendant le tri

| ID | Situation | Aujourd'hui | Il faudrait |
|---|---|---|---|
| C-13 | **Solde à 0 au milieu** du tri | Pause « plus de crédits » ; gardées suivantes visibles mais impayées et non contactables ; elles le restent après recharge (S-02) | Régler à la reprise ; afficher « 120 gardées en attente de crédits » |
| C-14 | Le client **change sa cible** | Re-tri complet, prix remesuré, choix manuels gardés, pilote qui continue sur les anciennes gardées (S-05), groupes figés (S-06) | Confirmation qui explique ; pause du pilote pendant le re-tri |
| C-15 | Le client **change son offre** | Aucun effet sur le tri (Q-04) | Re-tri ou message |
| C-16 | Le client **change les villes/activités** d'une campagne lancée | Ajoutées = recherchées à la suite ; retirées = plus recherchées, fiches gardées | Bien ; le dire avant d'enregistrer |
| C-17 | Le client **écarte par erreur** | Disparue pour toujours | E-05 |
| C-18 | Le client **garde 200 « à vérifier » d'un coup** | Payées immédiatement (jusqu'à 800 crédits), sans confirmation | E-04 |
| C-19 | Entreprise **déjà contactée** dans une autre campagne | Rattachée gratuitement, jamais recontactée, pas montrée | E-15 |
| C-20 | Entreprise **déjà dans le dossier** mais jamais payée | Gratuite (S-03) | Corriger |
| C-21 | **Site injoignable** | « À vérifier » avec raison | E-14 |
| C-22 | Les **groupes arrivent** alors que l'envoi tourne déjà avec un seul message | Encart sur l'écran 2, que le client ne regarde plus | E-13 |
| C-23 | **Pause « trop difficile »**, le client clique « Reprendre » sans rien changer | Repart, puis se remet en pause au prochain tri | Bloquer « Reprendre » sans changement, ou l'expliquer |
| C-24 | Une **« À vérifier » gardée** après l'arrivée des groupes | Jamais classée : reçoit « Pour les autres » | La classer au moment du « Garder » |

### 7.3 Message et expéditeur

| ID | Situation | Aujourd'hui | Il faudrait |
|---|---|---|---|
| C-25 | **Aucun expéditeur** | Bandeau orange dans Message, aperçu vide ; dans Envoi, bandeau avec bouton mal nommé (V-07) ; « Lancer » grisé | Créer l'expéditeur sur place |
| C-26 | **Plusieurs expéditeurs** | Choix dans Message et dans Envoi (même réglage, deux endroits) | Un seul endroit (Envoi) |
| C-27 | Expéditeur **supprimé** pendant que le pilote tourne | La campagne passe sur l'expéditeur par défaut, sans le dire | Avertir sur la campagne concernée |
| C-28 | Message **sans le nom de sa société** | Alerte + enregistrement refusé | Bien |
| C-29 | **Variable inconnue** (`{prenom}`) | Alerte | Bien ; proposer la bonne variable |
| C-30 | Info manquante pour une entreprise (ville, note) | Phrase retirée en silence (M-07) | Le montrer dans l'aperçu |
| C-31 | Message **renommé ou supprimé** pendant que le pilote tourne | Erreur « rechargez la page » à la modification ; le pilote peut ne plus avoir de message | Identifiant stable (M-06) |
| C-32 | Quitter l'écran **sans enregistrer** | Texte perdu (M-02) | Garde de sortie / brouillon |
| C-33 | **30 propositions IA** utilisées | « Réessayez demain » | Bien |
| C-34 | **Deux membres** modifient le message en même temps | Le dernier écrase | T-11 |
| C-35 | Mode groupes, **« Pour les autres » vide** | Les hors-groupes reçoivent le message d'un autre groupe (M-10) | Bloquer ou dire qu'ils ne seront pas contactés |

### 7.4 Envoi

| ID | Situation | Aujourd'hui | Il faudrait |
|---|---|---|---|
| C-36 | Pilote lancé **pendant la recherche** | S'arrête dès qu'il a rattrapé le tri (S-08), e-mail « terminé » | Attendre |
| C-37 | **Aucune gardée** encore, le client ouvre Envoi | « Tous les prospects ont déjà été contactés » (faux) (V-08) | Message juste |
| C-38 | **Gardées mais prix pas encore mesuré** | Même message faux : elles ne sont pas encore payées | « Prix en cours de mesure : l'envoi pourra commencer dans quelques minutes » |
| C-39 | Lancement **un vendredi à 19 h** en heures de bureau | « Hors des heures de bureau : prochain envoi lundi 9 h » | Bien ; le dire **avant** de lancer |
| C-40 | Campagne **multi-pays** | Heures de bureau d'une seule ville (S-10) | Heure locale par entreprise |
| C-41 | **Jour férié** | Envois quand même | Calendrier par pays |
| C-42 | Le client met la **recherche en pause** pour « tout arrêter » | Le pilote continue d'envoyer (E-12) | Pause globale explicite |
| C-43 | Le client **archive** pendant le pilote | Tout s'arrête ; formulaires en attente bloqués à vie | Les libérer |
| C-44 | **Captcha / pas de formulaire / champ inconnu** (≈ 1 sur 2) | « Mis de côté », payées, rien d'autre | Liste « À contacter vous-même » (V-06) |
| C-45 | Envoi **sans confirmation** visible sur le site | « À vérifier », au client de trancher | R-05 |
| C-46 | Le client règle **« par jour »** dans Avancé | Sans effet sur le pilote (V-05) | Le dire |
| C-47 | **Pilote + préparations manuelles** (Avancé) en même temps | Les deux tournent ; les envois du pilote consomment la limite du jour des envois manuels | Un seul mode actif à la fois, ou une seule limite |
| C-48 | Le client **décoche une version** en mode groupes | Peut partir quand même (S-11) | Avertir |
| C-49 | **Plus de forfait** pendant que le pilote tourne | « Aucun forfait en cours : le pilote attend » | Bien ; e-mail |

### 7.5 Après

| ID | Situation | Aujourd'hui | Il faudrait |
|---|---|---|---|
| C-50 | Une entreprise **répond** | Réponse dans la boîte de l'expéditeur ; l'appli ne le sait pas | R-01 (au moins un marquage manuel) |
| C-51 | Une entreprise demande à **ne plus être contactée** | « Ne jamais contacter » existe dans les formulaires (Avancé) ; pas depuis Résultats ni l'écran 2 | Le proposer partout où l'entreprise apparaît |
| C-52 | Le client veut **refaire la même campagne** ailleurs | « Dupliquer » → page Modifier, **phrase cible vide** (S-17) | Copier la phrase |
| C-53 | Le client **exporte** | Toutes les fiches, écartées comprises (T-08) | Gardées seulement |
| C-54 | Le client veut **contacter plus** | « Contacter d'autres entreprises » relance le réglage ; si plus de gardées : message de blocage | Proposer « Élargir la zone » |
| C-55 | **Lien direct** vers une étape (`?etape=resultats`) d'un brouillon | L'étape s'affiche, vide | Bien (pas d'erreur) |
| C-56 | **Ancienne campagne sans phrase cible** | Ancien écran de recherche dans le nouveau rail | T-12 |

---

## 8. Écarts avec le cahier des charges du 9/11

| CDC | Prévu | Aujourd'hui |
|---|---|---|
| §5.2 Écran 2 | « Petite mention à côté des onglets : 2 crédits par entreprise gardée » | Dans une bulle masquée : invisible (E-01). |
| §5.1 | « Une fiche gardée sans formulaire reste payée : le client la voit, avec son téléphone et son site » | Ni téléphone ni site sur la ligne (E-03, V-06). |
| §5.1 | « Afficher “Déjà contactée” sans débit » | Exclue sans être montrée (E-15). |
| §5.1 | « Export : seulement les fiches payées » | Export de toutes les fiches de la campagne (T-08). |
| §6 Écran 2 | « 18 240 fiches examinées » et une barre | Remplacé par « N recherches faites sur M » + 2 barres (E-07). |
| §6 Écran 4 | « Lancer la campagne » avec un résumé « 1 060 entreprises · 2 versions » ; après : « Campagne lancée. Premiers formulaires dans quelques minutes. » | Textes écrits mais non affichés (V-01). |
| §6 Écran 4 | « Prises de contact par jour » et « Validation automatique » dans l'écran Envoi | Rangés dans Avancé, sans effet sur le pilote (V-05). |
| §6 Écran 5 | Contactées / réponses / intéressés ; comparaison des versions (taux de réponse) | Envois seulement (R-01, R-04). Décision du 10/11 assumée. |
| §3 | Filtres gardés dans « Plus de critères » fermé | Fait, mais avec des valeurs par défaut restrictives (Q-01). |
| §4.3 | Groupes « Créer N campagnes » | Remplacé le 10/11 par « Un message par groupe ». Conforme à la décision. |

---

## 9. Recommandations par ordre de priorité

### À faire avant le premier vrai client (petits chantiers, gros effet)

1. **Q-01** – Critères par défaut neutres, et affichés quand ils filtrent. *(petit)*
2. **T-08** – Export et page Prospects limités aux entreprises gardées. *(petit)*
3. **E-01 / T-03** – Prix par gardée, solde et coût de la campagne en texte visible. *(petit)*
4. **V-01** – Fenêtre de confirmation avant « Lancer le pilote », avec récapitulatif. *(petit)*
5. **M-01 / V-04** – Toutes les versions écrites cochées par défaut. *(petit)*
6. **V-07 / V-08 / T-02** – Corriger les textes faux et les anciens noms d'étapes. *(petit)*
7. **M-02** – Avertissement ou enregistrement automatique du message. *(petit)*
8. **S-01 / S-02** – Fixer le prix en fin de recherche même sous 300 triées ; payer les gardées en attente à la
   reprise et à chaque recharge. *(petit, base)*
9. **S-08** – Le pilote attend les nouvelles gardées tant que la recherche ou le tri tournent. *(petit, base)*
10. **E-12** – « Mettre en pause » qui dit ce qu'il arrête, et une vraie pause globale. *(petit)*

### Ensuite (chantiers moyens)

11. **Q-09** – Plafond « Arrêter à N entreprises gardées ». *(moyen, touche la base)*
12. **E-03** – Site, activité et fiche complète sur chaque entreprise. *(moyen)*
13. **L-01** – Colonne « À faire » dans la liste des campagnes. *(petit : la logique existe)*
14. **V-06 / R-03** – Liste « À contacter vous-même » pour les mises de côté. *(moyen)*
15. **R-01 / R-02** – Où arrivent les réponses + liste des contactées + marquage manuel « a répondu ». *(moyen)*
16. **E-05** – « Annuler » de quelques secondes après Garder/Écarter. *(petit)*
17. **E-07 / E-08 / E-11** – Avancement en langage clair, taux de garde, pause « jusqu'à minuit ». *(moyen)*
18. **T-06** – E-mails quand la campagne a besoin du client. *(moyen)*

### Plus tard

19. Modification sur place (ciblage, expéditeur) sans quitter la campagne (Q-14, M-09, T-05).
20. Un seul jeu de réglages d'envoi pour le pilote et l'Avancé (V-05).
21. Recherche et filtres dans « Vos entreprises » (E-06).
22. Version courte générée automatiquement (M-05).

---

## 10. Questions à trancher (business)

Chaque question a une recommandation ; c'est à Gabriel (et Nath) de décider.

1. **Note maximale 3,5 par défaut (Q-01)** : voulue pour toutes les campagnes, ou héritée ? *Reco : défaut neutre 1-5.*
2. **Plafond de crédits par campagne (Q-09)** : l'ajouter ? avec quel défaut à la 1re campagne ? *Reco : oui, 500.*
3. **Aperçu des 3 premiers formulaires (V-01)** : le réactiver seulement pour la 1re campagne d'un client ?
   *Reco : oui, avec la confirmation dans tous les cas.*
4. **Nombre par défaut du pilote (V-02)** : 500 ou moins à la 1re campagne ? *Reco : 50.*
5. **Versions B/C/D (M-01)** : les garder visibles tant que les réponses ne sont pas suivies ? *Reco : une seule
   version visible, « + Ajouter une version » discret, toutes cochées par défaut.*
6. **Entreprises payées sans formulaire (V-06)** : les rendre au client avec téléphone/site (liste exportable) ?
   *Reco : oui ; c'est ce qui rend « 1 crédit = 1 entreprise gardée » juste.*
7. **Annuler un « Écarter » ou un « Garder » pendant quelques secondes (E-05)** : compatible avec la décision du 9/11 ?
   *Reco : oui.*
8. **Changer l'offre relance-t-il le tri (Q-04)** ? *Reco : oui, comme la phrase, avec le même avertissement.*
9. **Onglet « Résultats » sans réponses (R-01)** : le renommer « Suivi » en attendant la V1.1 ? *Reco : oui.*
10. **Limite de campagnes en cours (S-18)** : ne compter que les recherches en cours (aujourd'hui) ou aussi les
    envois en cours ? *Reco : garder tel quel (c'est la recherche qui coûte), mais le dire au client.*
11. **Petite campagne (S-01)** : sous 300 entreprises triées, quel prix appliquer ? *Reco : la part mesurée sur ce qui
    a été trié, ou 1 crédit si moins de 50.*
