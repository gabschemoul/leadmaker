# Cahier des charges : nouveau parcours campagne, tri IA, crédit unique, annuaire commun

Rédigé le 9 novembre 2026, à partir d'une conversation avec Gabriel. Toute l'équipe a validé la direction.
Ce document est destiné à la conversation Claude qui va développer. **Lire d'abord `docs/prospectigo/ARCHITECTURE.md`.**
Ses règles d'or s'appliquent toutes : staging, migrations compatibles avec `main` et poussées par Gabriel, mots interdits, robots un par un, aucune relance sans « oui ».

Maquette UX (ordre des écrans, infos demandées, actions) : `docs/prospectigo/maquette-parcours-ux/`.
**Ce n'est que de l'UX, pas du design.** Tout doit être fait avec la direction artistique et les composants actuels de l'appli.

---

## 0. Pourquoi

Gabriel est lui-même client, via Studio Namma. Sa campagne « Agences digital » a donné 36 764 fiches très hétérogènes. Le test de tri sur 200 fiches a donné :
- 24 bonnes cibles ;
- 35 qui font déjà du web ;
- 114 hors cible ;
- 27 incertaines.

Le vrai frein, c'est donc le tri des fiches. Il faut :
- un tri IA qui comprend la cible décrite en mots ;
- un parcours plus simple ;
- un crédit unique, facile à comprendre ;
- ne jamais payer deux fois la même recherche.

## 1. Décisions prises (ne pas rediscuter)

| Sujet | Décision |
|---|---|
| Parcours | Campagne = **Qui ? → Vos entreprises → Votre message → Envoi → Résultats** |
| Tri | IA (`claude-haiku-5-5`) sur chaque fiche, selon la cible en mots + l'offre du client. 3 piles : gardées / à vérifier / écartées |
| Écartées | **Pas d'onglet « Écartées »** à l'écran. Pas de bouton « Écarter » dans « Gardées » (seulement dans « À vérifier ») |
| Estimation | **Supprimée en V1** (plus d'estimation avant lancement, plus de « 10 exemples ») |
| Crédit | **Un seul crédit : 1 crédit = 1 entreprise gardée, prise de contact incluse** |
| Prix selon la difficulté | Paliers 1 / 2 / 4 crédits selon la part de fiches gardées, mesurée sur les premières fiches puis figée. Pause sous 6 % |
| Forfaits | Mêmes prix. Volumes = anciens volumes de prises de contact : 15 000 / 40 000 / 100 000 crédits pour 499 / 990 / 1 999 $ |
| « Proposer avec l'IA » (message) | Modèle intermédiaire (`claude-sonnet-5-5`), plafond proposé : 30 propositions par jour et par compte |
| Réglages d'envoi | **Inchangés** : ceux de l'appli actuelle (voir §6) |
| Annuaire commun | Toutes les fiches trouvées sont gardées dans une base commune à tous les clients et réutilisées pendant 3 mois (§8) |
| Limite de contacts entre clients | **Aucune.** Une entreprise peut être contactée par autant de clients que nécessaire (décision Gabriel) |
| Liste d'opposition commune | **Non.** Les demandes d'opposition arrivent chez le client, pas chez Prospectigo. Les fiches sont des données que l'entreprise publie pour être contactée (avis de l'avocat de Gabriel) |
| Résultats instantanés | **Interdits.** Une fiche qui vient de l'annuaire doit arriver progressivement, comme une vraie recherche (§8.4) |
| Classement automatique des réponses | V1.1, pas en V1 (la maquette le dessine, l'ignorer pour l'instant) |

## 2. Ordre de livraison

Un lot à la fois, chacun d'abord en pré-production, testé par Gabriel, puis publié sur son « publie ».
Pour les robots, un seul changement à la fois.

1. **Annuaire, étape 1 : garder toutes les fiches vues** (§8.2). Invisible pour le client. On arrête de jeter les fiches.
2. **Lien campagne ↔ entreprise** (§7). Prérequis pour réutiliser les fiches et créer plusieurs campagnes.
3. **Tri IA** (§4), branché sur les campagnes existantes. On mesure d'abord, sans rien changer au prix.
4. **Crédit unique et paliers** (§5) : base, facturation, site, textes.
5. **Nouveau parcours** : écrans 1 à 5 (§3, §6), dont « Proposer avec l'IA » et les groupes.
6. **Annuaire, étape 2 : réutiliser** les recherches de moins de 3 mois (§8.3), avec l'arrivée progressive (§8.4).
7. **Annuaire, étape 3 : remettre à jour** les fiches de plus de 3 mois (§8.5).

Mettre à jour `ROADMAP.md` (n°20) et `ARCHITECTURE.md` à chaque lot livré.

---

## 3. Écran 1 « Qui ? »

Fichier de maquette : `Main.dc.html`.

- **Une phrase libre** : « Qui voulez-vous contacter ? » (ex. « Agences marketing »). C'est la cible envoyée au tri IA.
- **Suggestions pour préciser**, en puces qui ajoutent ou retirent un bout de phrase. Exemples : « Sans celles qui font du web », « 2 personnes ou plus », « Avec un vrai site ». Elles sont proposées par l'IA d'après la phrase. Elles se mettent à jour toutes seules quand on arrête de taper (environ 1 s), sans bouton.
- **« On cherchera »** : les activités qui seront cherchées. Elles sont proposées d'après la phrase, parmi `lm_categories` (catégories de fiches, `gcid`, libellés fr/en). Le client peut en ajouter ou en retirer.
  - Proposer : un appel `claude-haiku-5-5`, avec en entrée la phrase et une présélection de catégories par recherche texte sur `label_fr` / `label_en` / `search_key`.
  - Garder la règle n°10 : c'est le client qui choisit ses activités.
- **Ligne « Trié selon votre offre : … · Modifier »** : rappel de l'offre du client (nouveau champ, §3.1).
- **« Où ? »** : reprendre **exactement** le ciblage actuel. Pays, puis « Tout le pays » / « Autour d'une ville » (ville + rayon km) / « Villes précises ». Mêmes règles (`lm_campaign_zones`, `lm_geo_cities`, option des villes de plus de X habitants).
- **Bouton « Lancer la recherche »**, avec une seule ligne : « Vous ne payez que les entreprises gardées. »
- **Plus d'écran d'estimation.** Le lancement démarre directement la recherche (`price_pending` = vrai jusqu'à la mesure du §5.2).

**Filtres actuels (DÉCIDÉ 9/11) :** la note moyenne, le nombre d'avis et avec / sans site restent, dans un pli « Plus de critères » fermé par défaut, sous « Où ? ». Ils ne sont pas dans la maquette, mais ils ne doivent pas disparaître.

### 3.1 Nouveau champ « Votre offre »

Ce champ n'existe pas aujourd'hui (rien dans `lm_spaces` ni `lm_sender_profiles`).
- Texte court, au niveau de l'équipe (`lm_spaces`, ex. colonne `offer text`).
- Demandé à la première campagne s'il est vide. Modifiable dans les réglages.
- Utilisé par le tri IA (une entreprise qui n'a pas besoin de l'offre est écartée, même si la phrase est courte) et par « Proposer avec l'IA ».

## 4. Tri IA

### 4.1 Ce que fait le tri

Pour chaque fiche trouvée dans une campagne :
1. **Lire la page d'accueil du site.** Sans proxy, environ 6 000 caractères de texte. Les réseaux sociaux (même liste que `NO_FORM_HOSTS`) ne sont pas lus. Garder ce texte dans l'annuaire (§8), pour ne pas relire un site pour chaque client.
2. **Appeler `claude-haiku-5-5`** avec `messages.parse` (sortie structurée) et `effort: low`. En entrée :
   - la cible (la phrase) ;
   - l'offre du client ;
   - les groupes de la campagne (§4.3) ;
   - la fiche (nom, activité déclarée, ville, site, nombre d'avis) ;
   - le texte du site.
3. **Sortie** : `verdict` (`gardee` | `a_verifier` | `ecartee`), `groupe` (un des groupes de la campagne ou `autre`) et `raison` (une phrase courte en français, concrète, affichée au client, ex. « Agence web, développe ses sites »).
   - Site injoignable ou illisible → `a_verifier`.

Le prompt du test qui a marché est dans l'historique de la conversation, avec le script `tri.py`. En résumé : « Ne te fie pas trop à l'activité déclarée, elle est souvent fausse. Le texte du site prime. » Le généraliser : la cible et l'offre viennent du client, plus de texte en dur pour les agences.

`ai_check.py` utilise déjà `claude-haiku-5-5` via `messages.parse` : s'en inspirer.

### 4.2 Coûts mesurés et réglages

- **Coût du tri :** environ 0,35 $ pour 1 000 fiches, soit environ 13 $ pour une campagne de 37 000 fiches. C'est négligeable face au proxy (environ 0,9 $ pour 1 000 fiches).
- **Délai :** le tri tourne au fil de l'eau, dans une file de tâches comme les autres robots (`lm_tasks`). Les premières entreprises triées doivent apparaître en quelques minutes.
- **Corrections du client :** « Garder » ou « Écarter » à l'écran 2 change la pile. Repêcher une fiche dans « À vérifier » coûte le prix d'une fiche gardée.
- **Changement de cible :** si le client modifie sa cible (« Modifier » à l'écran 2), on retrie les fiches déjà trouvées. Le texte du site est déjà en annuaire, donc il ne reste que le coût IA.

### 4.3 Groupes (« Créer N campagnes »)

- **Quand ils apparaissent :** une fois qu'il y a assez de fiches gardées (par exemple 100), un appel `claude-sonnet-5-5` propose 2 à 5 groupes à partir de la cible, de l'offre et d'un échantillon de raisons du tri (ex. « Marketing et com », « Branding », « Design graphique »).
- **Classement des fiches :** les fiches suivantes reçoivent leur groupe pendant le tri. Les fiches déjà triées sont reclassées par un passage Haiku.
- **L'encart :** il s'affiche si au moins 2 groupes pèsent chacun 15 % ou plus : « 3 groupes repérés. Un message par groupe ? » avec deux boutons.
  - **« Créer 3 campagnes »** crée une campagne par groupe. Elles partagent les fiches déjà trouvées (lien du §7), sans nouvelle recherche, et chacune a son propre message.
  - **« Un seul message »** ferme l'encart et laisse une ligne « Un seul message pour les 3 groupes · Changer ».

## 5. Crédit unique

### 5.1 La règle

- **1 crédit = 1 entreprise gardée**, prise de contact comprise. Plus de « crédits de prise de contact ».
- **Débité quand la fiche passe en « Gardées »**, que ce soit par l'IA ou par le client. Une fiche gardée sans formulaire reste payée : le client la voit, avec son téléphone et son site.
- **Gratuit :** les fiches écartées et les fiches « À vérifier » tant qu'elles n'ont pas été gardées.
- **Pas de double paiement (DÉCIDÉ 9/11) :** une entreprise déjà gardée et payée par une équipe n'est pas redébitée si elle revient dans une autre campagne de cette équipe. Raison : elle ne sera de toute façon pas recontactée (§7, `lm_attempts` unique par équipe), le client n'obtient donc rien de nouveau. Dans la nouvelle campagne, l'afficher comme « Déjà contactée » (ou « Déjà dans une autre campagne ») sans débit.
- **Pas d'export CSV aujourd'hui.** S'il en arrive un un jour, il ne doit sortir que des fiches payées.

### 5.2 Paliers selon la difficulté

| Part de fiches gardées | Prix d'une entreprise gardée |
|---|---|
| 25 % ou plus | 1 crédit |
| de 12 à 25 % | 2 crédits |
| de 6 à 12 % | 4 crédits |
| moins de 6 % | pause : le client doit préciser sa cible |

- **Mesure :** sur les premières fiches triées de la campagne (environ 300), puis le prix est figé (`credits_per_prospect`, `price_pending` = faux).
- **Fiches gardées pendant la mesure :** elles sont débitées au palier final.
- **Où sont les paliers :** `lm_discovery_settings.credit_tiers`, lus par `lm_credits_for_rate`. Le « taux » devient la part de fiches **gardées par l'IA** au lieu du taux de correspondance des filtres.
- **Écran 2 :** afficher une petite mention à côté des onglets, « 2 crédits par entreprise gardée ».
- **Pourquoi ces seuils :** une fiche examinée nous coûte environ 0,125 centime (proxy + tri). Avec ces paliers, une entreprise gardée nous coûte au plus environ 0,5 centime par crédit. La marge, au pire, est de 74 à 84 % (contre 85 à 90 % aujourd'hui). À recaler après 2 ou 3 vraies campagnes.

### 5.3 Ce qu'il faut changer

- **Base :** `lm_account_credits` a `discovery_balance` et `outreach_balance`, et `lm_plans` a `discovery_credits` et `outreach_credits`.
  - Passer à un seul solde, en ajoutant avant de retirer.
  - Les sends (`lm_queue_sends`, `lm_debit_credits`, `lm_outreach_reserved`) ne débitent plus rien.
  - **Soldes existants (DÉCIDÉ 9/11) :** seuls les comptes internes de l'équipe existent. Aucune conversion à prévoir : on met simplement le nouveau solde unique au volume du forfait de chaque compte.
- **Planificateur :** `lm_schedule_discovery` et `lm_campaign_categories.kept` doivent compter les fiches **gardées par l'IA**. Il favorise déjà les activités qui rapportent par Mo et abandonne les autres. Avec ce changement, il cesse de dépenser du proxy pour des activités hors cible.
- **Forfaits :** volumes 15 000 / 40 000 / 100 000. Mettre à jour Stripe (`docs/prospectigo/stripe-mode-reel.md`), `billing.config.ts`, la page Tarifs, la FAQ et les packs de crédits supplémentaires (n°5). Packs : même mot « crédits » ; proposer des prix au prorata du forfait Starter (499 $ / 15 000 ≈ 3,3 centimes le crédit) et les faire valider par Gabriel avant de les mettre dans Stripe.
- **Vocabulaire :** remplacer « crédits de prospection » et « crédits de prise de contact » par un seul mot, partout (appli, site, e-mails, en et fr). **Le mot (DÉCIDÉ 9/11) : « crédits »** (en anglais « credits »). Mettre à jour la mémoire « Vocabulaire Prospectigo » et `ARCHITECTURE.md` §1 et §7.

## 6. Écrans 2 à 5

### Écran 2 « Vos entreprises » (`Entreprises.dc.html`)

- Titre, cible sur une ligne avec « Modifier » (retour à l'écran 1, puis nouveau tri).
- Avancement discret : « 18 240 fiches examinées » et une barre.
- Encart des groupes (§4.3).
- Onglets **Gardées** et **À vérifier**, avec leurs nombres. Pas d'onglet « Écartées ».
- Chaque ligne affiche le nom, la ville et la raison courte du tri.
  - Dans « Gardées » : aucun bouton.
  - Dans « À vérifier » : « Garder » et « Écarter ».
- Bouton « Suivant : le message ».
- Les entreprises déjà contactées par l'équipe sont exclues automatiquement (règle actuelle : `lm_attempts` est unique par équipe et par entreprise).

### Écran 3 « Votre message » (`Message.dc.html`)

- **Versions A, B, + (jusqu'à 4)** : alternance équilibrée, comme aujourd'hui (`pick_balanced` dans `outreach/templates.py`, avec sa version courte).
- **« Proposer avec l'IA »** remplace le texte de la version ouverte. Modèle `claude-sonnet-5-5`, environ 0,6 centime par clic.
  - En entrée : l'offre, la cible, le groupe et 3 fiches gardées en exemple.
  - Plafond : 30 par jour et par compte, avec un message clair quand il est atteint.
- **Boutons « Insérer : Entreprise / Ville / Activité »** : ils ajoutent les variables existantes.
- **Aperçu** du formulaire rempli sur une vraie entreprise gardée, avec « Autre » pour en voir une autre.

### Écran 4 « Envoi » (`Envoi.dc.html`)

Garder **les réglages et les mots actuels de l'appli** (décision ferme de Gabriel : ne rien casser). Seule la présentation est regroupée.
- **Planification :** « Heures de bureau (recommandé) », « Étalé sur plusieurs jours » (« Répartir sur » N jours, de 1 à 60) ou « En continu ».
- **« Prises de contact par jour, au maximum »** (1 à 100 000). Petit calcul à côté : « ≈ N jours pour tout envoyer ».
- **« Validation automatique »**, avec son avertissement actuel tel quel. Le pilote automatique et le mode Avancé (n°18) restent.
- **Expéditeur** (profils multiples, n°6).
- **« Lancer la campagne »**, avec un résumé sur une ligne : « 1 060 entreprises · 2 versions ».
- **Après le lancement :** « Campagne lancée. Premiers formulaires dans quelques minutes. » Il faut environ 7 minutes, mesuré, pour préparer un formulaire. Ne jamais promettre « une heure ».

### Écran 5 « Résultats » (`Resultats.dc.html`)

- **3 chiffres :** entreprises contactées sur le total, réponses, intéressés.
- **Comparaison des versions** (taux de réponse), avec « Garder seulement la A ».
- **Liste des réponses.** Le classement Intéressé / Question est pour la V1.1.

## 7. Lien campagne ↔ entreprise (prérequis)

**Aujourd'hui :**
- `lm_prospects` est unique sur (`space_id`, `site_key`) et n'a qu'un `campaign_id` : la première campagne qui a trouvé l'entreprise.
- `lm_record_prospect` renvoie « duplicate » aux campagnes suivantes.
- `lm_prepare_prospects` fait `coalesce(p.campaign_id, p_campaign_id)`.

Une entreprise ne peut donc appartenir qu'à une campagne. Ça bloque les groupes, la réutilisation et l'annuaire.

**À faire :**
- **Nouvelle table de lien** campagne ↔ prospect (ex. `lm_campaign_prospects`), avec par campagne : verdict IA, groupe, raison, choix du client, date et crédits débités.
- **Garder `campaign_id`** pendant la transition, pour rester compatible avec `main`.
- **Le contact reste unique par équipe :** `lm_attempts` reste unique sur (`space_id`, `prospect_id`). Une entreprise n'est jamais contactée deux fois par la même équipe, même depuis deux campagnes.

## 8. Annuaire commun

### 8.1 Mesures (9/11, base réelle)

- **Recherches déjà rangées :** `lm_searches` compte 40 348 recherches et 99 Go de proxy. Elles sont déjà rangées par (`country_code`, `category` = catégorie de fiche, `zone_key` = ville). C'est la clé de l'annuaire.
- **Peu de répétitions pour l'instant :** seules 18 recherches ont été refaites. Le gain grandira avec le nombre de clients.
- **Fiches jetées :** `lm_place_sightings` a vu 481 000 entreprises, mais `lm_prospects` n'en garde que 211 000. Pour les autres, on a payé le proxy et seul l'identifiant est conservé.
- **Taille :** 211 000 fiches font 217 Mo. 10 millions de fiches feraient environ 10 Go, ce qui n'est pas un problème pour Postgres.

### 8.2 Étape 1 : garder toutes les fiches vues

Tables **communes à tous les clients**. Elles ne contiennent que des infos publiques et ne sont pas lisibles par les clients (RLS fermée, accès par fonctions `security definer` ou par les robots).

- **`lm_places`** : une ligne par entreprise, unique sur `google_place_id`.
  - Contenu : nom, catégorie (`gcid`), adresse, ville, pays, latitude et longitude, téléphone, site, `site_key`, note moyenne, nombre d'avis, lien de la fiche, chaîne oui/non.
  - Contenu du site : texte de la page d'accueil (§4.1) et état du site (ok / injoignable / réseau social).
  - Dates : première vue, dernière mise à jour de la fiche, dernière lecture du site.
- **`lm_place_searches`** ou équivalent : pour chaque (pays, catégorie, ville ou zone), la date de la recherche et les entreprises trouvées.
- **Index :** `google_place_id` (unique), (`country_code`, ville), `gcid`, `site_key`. Ajouter un index géographique (PostGIS ou grille) pour « Autour d'une ville ».
- **Écriture :** les robots de recherche écrivent dans ces tables **tout ce qu'ils voient**, même les fiches non gardées. `lm_prospects` reste la copie propre à chaque équipe.
- **Données existantes :** les copier depuis `lm_prospects`. C'est un seul envoi, piloté par Gabriel.

### 8.3 Étape 2 : réutiliser

Pour chaque (activité × ville) d'une campagne :
- **Recherche faite il y a moins de 3 mois :** prendre les entreprises dans l'annuaire, sans proxy, puis lancer le tri IA pour la cible du client.
- **Sinon :** faire la vraie recherche, qui alimente l'annuaire.

Règles :
- Un client ne voit jamais ce que les autres clients ont cherché, gardé ou contacté. Seule la fiche publique est partagée.
- Les filtres du client (note, avis, site) s'appliquent après, sur les fiches de l'annuaire.
- Le prix pour le client ne change pas. Une fiche venue de l'annuaire est payée comme les autres, parce qu'il paie la fiche gardée. C'est notre coût qui baisse.
- Durée de validité (90 jours) réglable dans `lm_discovery_settings`.

### 8.4 Pas d'arrivée instantanée (décision Gabriel)

Les fiches de l'annuaire ne doivent pas apparaître d'un coup : **il faut que ça ait l'air d'une vraie recherche**.
- Les livrer progressivement, par petits paquets, avec un rythme un peu irrégulier.
- **Rythme (DÉCIDÉ 9/11, réglable dans `lm_discovery_settings`) :**
  - premières fiches après **20 à 40 secondes** (tirage au hasard) ;
  - ensuite un paquet toutes les **3 à 8 secondes**, de **10 à 40 fiches** chacun (tirage au hasard à chaque paquet), soit environ 15 000 fiches par heure, un peu plus vite qu'une vraie recherche (~7 000 par heure) ;
  - **durée totale minimale : 3 minutes**, même s'il y a peu de fiches ;
  - si l'annuaire ne couvre qu'une partie des activités ou des villes, les vraies recherches tournent en même temps et leurs fiches se mélangent aux autres ;
  - le tri IA traite les fiches au fur et à mesure qu'elles « arrivent », pas avant.
- La barre « fiches examinées » avance de la même façon.
- Les écrans et les e-mails ne disent jamais « déjà en base » ou « annuaire ». Pour le client, Prospectigo cherche.

### 8.5 Étape 3 : remettre à jour

- **À la demande, pas automatiquement :** on ne remet à jour une recherche ou une fiche que quand une campagne en a besoin et qu'elle a plus de 3 mois. Remettre à jour sans arrêt des millions de fiches que personne ne demande coûterait du proxy pour rien.
- **Signes de mort :** si le robot de préparation trouve le site mort, ou si la fiche n'apparaît plus dans une nouvelle recherche, le noter dans `lm_places` (ex. `closed_at`) et ne plus la proposer.

## 9. À valider avec Gabriel avant de coder (récapitulatif)

Réponses de Gabriel du 9/11 :
1. Filtres note / avis / site : **gardés dans un pli « Plus de critères »** (§3).
2. Mot unique : **« crédits »** (§5.3).
3. Soldes existants : **pas de conversion**, seuls les comptes internes existent (§5.3). Prix des packs : à proposer puis faire valider.
4. Une entreprise déjà payée par l'équipe : **jamais payée deux fois** (§5.1).
5. Rythme d'arrivée : **choisi, voir §8.4**.
