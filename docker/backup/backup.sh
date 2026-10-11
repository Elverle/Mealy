#!/bin/sh
# Dump compresso del database in /backups e rotazione dei dump con la stessa etichetta.
# Uso: sh backup.sh [etichetta]   (default: daily; solo lettere minuscole e cifre)
# Connessione da PGHOST, PGUSER, PGPASSWORD, PGDATABASE (v. docker-compose.prod.yml).
set -eu
set -o pipefail

LABEL="${1:-daily}"
KEEP="${BACKUP_KEEP:-7}"
DIR="/backups"

case "$LABEL" in
  *[!a-z0-9]* | "")
    echo "[backup] etichetta non valida: '$LABEL' (ammesse solo lettere minuscole e cifre)" >&2
    exit 2
    ;;
esac
case "$KEEP" in
  *[!0-9]* | "" | 0)
    echo "[backup] BACKUP_KEEP non valido: '$KEEP' (serve un intero maggiore di 0)" >&2
    exit 2
    ;;
esac

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${DIR}/mealy-${LABEL}-${STAMP}.sql.gz"
TMP="${FILE}.tmp"

mkdir -p "$DIR"
trap 'rm -f "$TMP"' EXIT

if ! pg_dump --no-owner --clean --if-exists | gzip -9 > "$TMP"; then
  echo "[backup] pg_dump fallito: nessun dump scritto, i dump esistenti restano dove sono" >&2
  exit 1
fi
if ! gzip -t "$TMP" || [ ! -s "$TMP" ]; then
  echo "[backup] dump non valido: scartato, i dump esistenti restano dove sono" >&2
  exit 1
fi
mv "$TMP" "$FILE"
echo "[backup] scritto ${FILE} ($(wc -c < "$FILE") byte)"

# Rotazione: solo dopo un dump riuscito, e solo tra i file con la stessa etichetta.
ls -1t "${DIR}"/mealy-"${LABEL}"-*.sql.gz | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
  rm -f "$old"
  echo "[backup] rimosso ${old}"
done
