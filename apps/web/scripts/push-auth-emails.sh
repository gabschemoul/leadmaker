#!/bin/bash
# Pousse les modèles d'e-mails de connexion (confirmation, mot de passe, changement d'adresse, lien magique,
# invitation Supabase) et leurs sujets vers le projet Supabase EN LIGNE (base partagée par prospectigo.com et
# staging.prospectigo.com : il n'y a qu'une seule version possible).
#
#   ./apps/web/scripts/push-auth-emails.sh            # pousse
#   ./apps/web/scripts/push-auth-emails.sh --check    # montre seulement ce qui changerait
#
# Il faut un jeton personnel Supabase (https://supabase.com/dashboard/account/tokens), déposé une fois dans
# ~/LeadMaker/app/.env.supabase-token (fichier ignoré par git) :   pbpaste > ~/LeadMaker/app/.env.supabase-token
# Ne touche à RIEN d'autre dans la configuration Auth (adresses de redirection, SMTP, Google…).
set -euo pipefail
cd "$(dirname "$0")/../../.."
REF=mqwpjzcpwibikjaiaybd
TOKEN_FILE=.env.supabase-token
MODE=${1:-push}

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  TOKEN=$SUPABASE_ACCESS_TOKEN
elif [ -s "$TOKEN_FILE" ]; then
  TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
else
  echo "Jeton Supabase manquant : créez-en un sur https://supabase.com/dashboard/account/tokens"
  echo "puis copiez-le et lancez :   pbpaste > $TOKEN_FILE"
  exit 1
fi

export TOKEN REF MODE
python3 -I - <<'PY'
import json, os, pathlib, sys, tomllib, urllib.request

root = pathlib.Path('apps/web/supabase')
cfg = tomllib.load(open(root / 'config.toml', 'rb'))['auth']['email']['template']
names = {'confirmation': 'confirmation', 'recovery': 'recovery', 'email_change': 'email_change',
         'magic_link': 'magic_link', 'invite': 'invite'}
body = {}
for key in names:
    tpl = cfg[key]
    body[f'mailer_subjects_{key}'] = tpl['subject']
    body[f'mailer_templates_{key}_content'] = (root / tpl['content_path'].removeprefix('./supabase/')).read_text()

url = f"https://api.supabase.com/v1/projects/{os.environ['REF']}/config/auth"
headers = {'Authorization': f"Bearer {os.environ['TOKEN']}", 'Content-Type': 'application/json'}

with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as r:
    remote = json.load(r)
changed = [k for k, v in body.items() if remote.get(k) != v]
if not changed:
    print('Les e-mails en ligne sont déjà à jour.'); sys.exit(0)
print('À mettre à jour :', ', '.join(changed))
if os.environ['MODE'] == '--check':
    sys.exit(0)
req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method='PATCH')
with urllib.request.urlopen(req) as r:
    r.read()
with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as r:
    remote = json.load(r)
still = [k for k, v in body.items() if remote.get(k) != v]
if still:
    print('ÉCHEC : différences restantes', still); sys.exit(1)
print('✓ E-mails de connexion mis à jour en ligne (français / anglais, couleurs Prospectigo).')
PY
