# LeadMaker

SaaS de prospection B2B : découverte d'entreprises locales sur Google Maps, préparation des formulaires de contact,
validation humaine, envoi et suivi des réponses. Construit sur MakerKit (Next.js + Supabase, édition Turbo) avec des
workers Python / Playwright pour les moteurs.

- **Cahier des charges de référence** : https://claude.ai/artifact/SqskF2RvHvw3vFRMLsCPyz
- **Prototype interne de référence** : `legacy/` (lecture seule, logique à réutiliser)
- **Base MakerKit** : documentation dans `docs/` et https://makerkit.dev/docs/next-supabase-turbo/introduction

## Structure cible

```
apps/web        application Next.js (MakerKit), interface FR + EN
apps/web/supabase/schemas/2x-leadmaker-*.sql   modèle de données LeadMaker (forfaits, crédits, espaces, campagnes, prospects, tentatives, tâches, géographie)
packages/       paquets MakerKit (comptes, facturation, UI…)
workers/        workers Python : file de tâches Postgres, découverte et outreach (moteurs à brancher aux lots 1 et 2)
legacy/         prototype interne et documents de cadrage
```

## Lancer en local

```bash
pnpm install
pnpm supabase:web:start          # base locale (Docker), migrations et données de référence
pnpm --filter web dev            # application sur http://localhost:3001 (le port 3000 est pris par une autre app sur le Mac de Gabriel)
# emails locaux (confirmation, invitations) : http://127.0.0.1:54324
pnpm supabase:web:test           # tests de la base, dont l'isolation entre organisations
cd workers && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres .venv/bin/python -m leadmaker_workers.main
```

## État

Lot 0 (fondations) démarré le 29/10/2026 :

- [x] MakerKit renommé LeadMaker, comptes d'équipe uniquement, interface FR et EN
- [x] Forfaits Growth / Business / Scale (prix Stripe à renseigner dans `.env`)
- [x] Modèle de données de la section 5 avec isolation par organisation, testée
- [x] Quotas d'espaces et de sièges par forfait, crédits découverte / outreach avec journal
- [x] File de tâches et worker Python conteneurisé (tâche factice)
- [x] GeoNames : 252 pays, ~198 000 villes
- [ ] Stripe en mode test (clés à fournir)
- [ ] Accès administrateur : une fois le compte créé, exécuter `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role": "super-admin"}' where email = '…'` puis activer la double authentification dans le profil ; le panneau est sur /admin
- [ ] Mesure des coûts réels (proxies) et calendrier réestimé
