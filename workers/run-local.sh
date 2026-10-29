#!/bin/zsh
# Lance un worker de découverte sur le Supabase local (Mac de développement).
cd "$(dirname "$0")"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export WORKER_KINDS=discovery WORKER_IDLE_SECONDS=3
exec .venv/bin/python -m leadmaker_workers.main >> logs/worker.log 2>&1
