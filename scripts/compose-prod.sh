#!/usr/bin/env bash
# docker compose per lo stack di produzione, con il file d'ambiente e l'immagine giusti.
# Uso: bash scripts/compose-prod.sh <argomenti di docker compose>   es.: ps | logs -f app
#   MEALY_ENV_FILE  file d'ambiente (default: .env.production)
#   MEALY_IMAGE     immagine dell'app (default: quella del commit in uso, v. scripts/image-name.sh)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE="${MEALY_ENV_FILE:-.env.production}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Manca ${ENV_FILE}: copialo da .env.production.example e compilalo." >&2
  exit 1
fi

if [ -z "${MEALY_IMAGE:-}" ]; then
  MEALY_IMAGE="$(MEALY_ENV_FILE="$ENV_FILE" bash scripts/image-name.sh)"
fi
export MEALY_IMAGE
# Git Bash su Windows: non convertire i percorsi del container (/opt/backup/...) in percorsi Windows.
export MSYS_NO_PATHCONV=1

exec docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"
