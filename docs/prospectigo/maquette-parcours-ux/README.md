# Maquette du nouveau parcours campagne : UX UNIQUEMENT

**Ce n'est pas du design.** Ces 5 écrans montrent seulement l'ordre des étapes, les informations demandées au client et les actions possibles.

Ne rien reprendre de leur apparence : couleurs, tailles, espacements, composants, mise en page exacte. Tout se construit avec la direction artistique et les composants actuels de l'appli. La référence visuelle est décrite dans `apps/web/styles/home.css` et dans les composants existants.

| Fichier | Écran |
|---|---|
| `Main.dc.html` | 1. Qui ? (cible en une phrase, activités, zone) |
| `Entreprises.dc.html` | 2. Vos entreprises (Gardées / À vérifier, groupes) |
| `Message.dc.html` | 3. Votre message (versions A/B, « Proposer avec l'IA », aperçu) |
| `Envoi.dc.html` | 4. Envoi (réglages actuels de l'appli) |
| `Resultats.dc.html` | 5. Résultats |

**Les chiffres et les noms sont des exemples.** Les noms d'entreprises viennent d'un vrai test de tri. Les fichiers utilisent un format de maquette (`<x-dc>`, `{{…}}`, `sc-if`, `sc-for`) qui n'a rien à voir avec le code de l'appli. Lisez-les seulement pour comprendre le parcours.

Version cliquable (privée, Gabriel doit la partager) : https://claude.ai/artifact/1Wo4tGY3z8btswzri5WqJ2

Le cahier des charges complet est dans `docs/prospectigo/CDC-PARCOURS-TRI-ANNUAIRE.md`.
