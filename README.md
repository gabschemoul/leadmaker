# Prospectigo

SaaS de prospection B2B vendu dans le monde entier : l'appli trouve les entreprises locales qui correspondent à
une zone et à des activités, puis dépose le message du client dans leur formulaire de contact (pilote automatique
ou validation formulaire par formulaire).

- **Documentation pour les développeurs et les IA : [`docs/prospectigo/ARCHITECTURE.md`](docs/prospectigo/ARCHITECTURE.md)**
  (règles d'or, carte du dépôt, modèle de données, crédits, robots, livraison).
- Feuille de route et décisions datées : [`ROADMAP.md`](ROADMAP.md).
- Dernier audit (sécurité, ergonomie, propreté) : [`docs/prospectigo/AUDIT-2026-11-05.md`](docs/prospectigo/AUDIT-2026-11-05.md).
- Robots : [`workers/README.md`](workers/README.md).
- Base : kit MakerKit (Next.js + Supabase, édition Turbo) ; sa documentation générique est dans `docs/` et sur
  https://makerkit.dev/docs/next-supabase-turbo/introduction.
- `legacy/` : prototype interne d'origine (lecture seule).

## En ligne

| Adresse | Branche | Rôle |
|---|---|---|
| https://prospectigo.com | `main` | site et appli des clients (mis à jour quand Gabriel dit « publie ») |
| https://staging.prospectigo.com | `staging` | pré-production (même base de données que la prod) |

## Lancer en local

```bash
pnpm install
pnpm supabase:web:start          # base locale (Docker)
pnpm --filter web dev            # appli sur http://localhost:3001 (le port 3000 est pris sur le Mac de Gabriel)
# e-mails locaux : http://127.0.0.1:54324
pnpm supabase:web:test           # tests de la base (pgTAP)
cd workers && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
./run-local.sh                   # robots sur la base locale (journaux : workers/logs/)
```

Toujours utiliser `pnpm exec supabase` depuis `apps/web` (la CLI Supabase globale du Mac est trop ancienne).

## Vérifications avant de livrer

```bash
pnpm typecheck && pnpm lint && pnpm format:fix
pnpm supabase:web:test           # si la base a changé
```
