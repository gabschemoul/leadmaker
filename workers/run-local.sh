#!/bin/zsh
# Lance les workers sur le Supabase local (Mac de développement) :
# 2 workers réservés aux estimations (rapides, en parallèle), 1 worker préparation des formulaires,
# 1 worker estimations puis campagnes.
cd "$(dirname "$0")"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export SUPABASE_URL=${SUPABASE_URL:-http://127.0.0.1:54321}
# Clé de service du Supabase LOCAL (clé de démonstration publique de la CLI, sans valeur hors de ce Mac)
export SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}
export WORKER_IDLE_SECONDS=2
for i in 1 2; do
  WORKER_KINDS=estimate WORKER_ID="estimate-$i" .venv/bin/python -m leadmaker_workers.main >> logs/worker-estimate-$i.log 2>&1 &
done
WORKER_KINDS=prepare WORKER_ID="prepare-1" .venv/bin/python -m leadmaker_workers.main >> logs/worker-prepare.log 2>&1 &
WORKER_KINDS=estimate,discovery exec .venv/bin/python -m leadmaker_workers.main >> logs/worker.log 2>&1
