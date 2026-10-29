# LeadMaker

SaaS de prospection B2B : découverte d'entreprises locales sur Google Maps, préparation des formulaires de contact,
validation humaine, envoi et suivi des réponses. Construit sur MakerKit (Next.js + Supabase, édition Turbo) avec des
workers Python / Playwright pour les moteurs.

- **Cahier des charges de référence** : https://claude.ai/artifact/SqskF2RvHvw3vFRMLsCPyz
- **Prototype interne de référence** : `legacy/` (lecture seule, logique à réutiliser)
- **Base MakerKit** : documentation dans `docs/` et https://makerkit.dev/docs/next-supabase-turbo/introduction

## Structure cible

```
apps/web        application Next.js (MakerKit)
packages/       paquets MakerKit (comptes, facturation, UI…)
workers/        moteurs Python : découverte Google Maps, outreach formulaires (à créer au lot 1)
legacy/         prototype interne et documents de cadrage
```

## État

Lot 0 non démarré. Voir la section 11 du cahier des charges.
