-- Nouveau type de tâche « sort » (tri IA). Écrit à la main : db diff proposait de recréer le type et de réécrire
-- toute la table lm_tasks (verrou long, fonctions qui dépendent du type). Un ajout de valeur suffit ; dans son
-- propre fichier, car une valeur ajoutée n'est utilisable qu'après la fin de sa transaction.
alter type public.lm_task_kind add value if not exists 'sort';
