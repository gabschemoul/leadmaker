-- Nouveau type de tâche : recherche d'e-mail sur le site (dans sa propre migration, une valeur d'enum
-- ne peut pas être utilisée dans la transaction qui l'ajoute).
alter type "public"."lm_task_kind" add value if not exists 'emails';
