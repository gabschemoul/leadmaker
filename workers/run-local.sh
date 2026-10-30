#!/bin/zsh
# Lance les workers sur le Supabase local (Mac de développement) :
# 2 workers réservés aux estimations (rapides, en parallèle), 6 workers préparation des formulaires / e-mails,
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
# Site de test (formulaire fictif qui enregistre ce qu'il reçoit) : http://formulaire-test.localhost:8089/
pgrep -f test_contact_site.py >/dev/null || (.venv/bin/python scripts/test_contact_site.py >> logs/test-site.log 2>&1 &)
# Robot d'envoi : coupé par défaut (SEND_WORKER=1 ./run-local.sh pour l'activer). Tant qu'il est coupé,
# les formulaires validés restent dans « Validés » et rien n'est envoyé aux entreprises.
if [ "${SEND_WORKER:-0}" = "1" ]; then
  WORKER_KINDS=send WORKER_ID="send-1" .venv/bin/python -m leadmaker_workers.main >> logs/worker-send.log 2>&1 &
fi
for i in 1 2 3 4 5 6; do
  WORKER_KINDS=prepare,emails WORKER_ID="prepare-$i" .venv/bin/python -m leadmaker_workers.main >> logs/worker-prepare.log 2>&1 &
done
WORKER_KINDS=estimate,discovery exec .venv/bin/python -m leadmaker_workers.main >> logs/worker.log 2>&1
