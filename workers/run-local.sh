#!/bin/zsh
# Lance les workers sur le Supabase local (Mac de développement) :
# 2 workers réservés aux estimations (rapides, en parallèle) + 1 worker estimations puis campagnes.
cd "$(dirname "$0")"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export WORKER_IDLE_SECONDS=2
for i in 1 2; do
  WORKER_KINDS=estimate WORKER_ID="estimate-$i" .venv/bin/python -m leadmaker_workers.main >> logs/worker-estimate-$i.log 2>&1 &
done
WORKER_KINDS=estimate,discovery exec .venv/bin/python -m leadmaker_workers.main >> logs/worker.log 2>&1
