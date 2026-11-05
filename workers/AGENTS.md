# Robots Prospectigo (Python / Playwright)

Contexte général : `docs/prospectigo/ARCHITECTURE.md` (§3 vue d'ensemble, §6 file de tâches). Mode d'emploi
opérationnel : `workers/README.md`.

## Règles

- **Stabilité avant tout** : un seul changement de robot à la fois ; déployer uniquement avec
  `scripts/deploy-robots.sh` (test avant bascule, `--rollback`), puis vérifier 10 minutes en prod. Annoncer un gain
  (vitesse, proxy) seulement après l'avoir mesuré sur le vrai trafic.
- **Jamais** relancer, libérer ou redémarrer des tâches, recherches ou robots en prod sans un « oui » explicite de
  Gabriel dans le message en cours.
- Le Python appelle les **fonctions SQL** (`lm_claim_task`, `lm_record_prospect`, `lm_finish_prepare`,
  `lm_finish_send`…) ; éviter les écritures directes dans les tables (quelques-unes subsistent dans `queue.py` et
  `outreach/runner.py`, à migrer vers des fonctions).
- Les robots de prise de contact ouvrent des sites venus d'internet ou de fichiers importés par les clients :
  toujours poser la garde réseau `outreach/netguard.py` sur un nouveau contexte de navigateur.
- Un envoi de formulaire n'est jamais réessayé automatiquement (il passe « à vérifier »).
- Secrets : `.env.cloud` (connexion à la base de prod) reste hors du dépôt, en `chmod 600`.
- `NETGUARD_ALLOW_PRIVATE=1` uniquement en local (`run-local.sh`), jamais sur les serveurs.

## Tester en local

`./run-local.sh` (base Supabase locale, faux site de formulaire sur http://formulaire-test.localhost:8089/).
`leadmaker_workers/selftest.py` est le test de fumée lancé par `deploy-robots.sh` avant chaque bascule.
