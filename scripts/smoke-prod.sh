#!/usr/bin/env bash
# Prova lo stack di produzione con un'immagine già costruita: avvio, migrazioni, alias,
# pagina iniziale, backup e riavvio. Usa un progetto compose a parte (mealy-smoke) e lo
# smonta alla fine, volumi compresi. Non tocca lo stack mealy-prod.
# Uso: docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke
#   SMOKE_PORT  porta host dell'app durante la prova (default: 3100)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  echo "Uso: bash scripts/smoke-prod.sh <immagine>" >&2
  exit 2
fi
PORT="${SMOKE_PORT:-3100}"
BASE_URL="http://127.0.0.1:${PORT}"

rm -rf .smoke
mkdir -p .smoke/backups
cat > .smoke/env <<ENVEOF
POSTGRES_PASSWORD=smokepassword123
LLM_PROVIDER=google
LLM_MODEL=smoke-model
APP_PORT=${PORT}
BACKUP_DIR=./.smoke/backups
ENVEOF

export MEALY_ENV_FILE=.smoke/env
export MEALY_IMAGE="$IMAGE"

compose() {
  bash scripts/compose-prod.sh -p mealy-smoke "$@"
}

cleanup() {
  compose down -v --remove-orphans > /dev/null 2>&1 || true
  rm -rf .smoke
}
trap cleanup EXIT

fail() {
  echo "SMOKE FALLITO: $1" >&2
  compose logs --no-log-prefix --tail 60 app >&2 || true
  exit 1
}

query() {
  compose exec -T db psql -U mealy -d mealy -At -c "$1"
}

echo "[smoke] avvio dello stack con ${IMAGE}"
compose up -d --wait --wait-timeout 180 || fail "lo stack non è diventato sano entro 180 secondi"

echo "[smoke] /api/health"
[ "$(curl -sS --max-time 10 "${BASE_URL}/api/health")" = '{"status":"ok"}' ] \
  || fail "/api/health non ha risposto {\"status\":\"ok\"}"

echo "[smoke] migrazioni e alias"
[ "$(query "select to_regclass('public.recipes') is not null")" = "t" ] \
  || fail "la tabella recipes non esiste: migrazioni non applicate"
[ "$(query "select count(*) > 0 from drizzle.__drizzle_migrations")" = "t" ] \
  || fail "nessuna migrazione registrata"
[ "$(query "select count(*) > 0 from ingredient_aliases")" = "t" ] \
  || fail "nessun alias caricato"
[ "$(query "select count(*) from recipes")" = "0" ] \
  || fail "ci sono ricette nel database: il bootstrap non deve inserirne"

echo "[smoke] pagina iniziale"
[ "$(curl -sS -L --max-time 20 -o /dev/null -w '%{http_code}' "${BASE_URL}/")" = "200" ] \
  || fail "la pagina iniziale non risponde 200"

echo "[smoke] backup"
compose exec -T backup sh /opt/backup/backup.sh daily || fail "backup.sh è uscito con errore"
set -- .smoke/backups/mealy-daily-*.sql.gz
{ [ "$#" -eq 1 ] && [ -s "$1" ] && gzip -t "$1"; } || fail "dump mancante o non valido in .smoke/backups"

echo "[smoke] riavvio: il bootstrap deve essere idempotente"
compose restart app > /dev/null
compose up -d --wait --wait-timeout 180 || fail "l'app non è tornata sana dopo il riavvio"
compose logs --no-log-prefix app | grep -q "alias inseriti o aggiornati: 0" \
  || fail "al secondo avvio il bootstrap ha riscritto degli alias"

echo "SMOKE OK"
