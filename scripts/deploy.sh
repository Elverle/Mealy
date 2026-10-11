#!/usr/bin/env bash
# Aggiorna Mealy sul Raspberry: codice, immagine, backup, riavvio, verifica.
# Uso: bash scripts/deploy.sh [--no-pull]
#   --no-pull  non esegue `git pull` né scarica l'immagine: riapplica la configurazione
#              (per esempio dopo una modifica a .env.production) con ciò che c'è già in locale.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

compose() {
  bash scripts/compose-prod.sh "$@"
}

# Tutto in una funzione: bash la legge per intero prima di eseguirla, quindi `git pull`
# può aggiornare questo file senza disturbare l'esecuzione in corso.
main() {
  local pull=1
  case "${1:-}" in
    "") ;;
    --no-pull) pull=0 ;;
    *)
      echo "Argomento sconosciuto: $1. Uso: bash scripts/deploy.sh [--no-pull]" >&2
      exit 2
      ;;
  esac

  if [ "$pull" -eq 1 ]; then
    echo "[deploy] aggiorno il codice"
    git pull --ff-only
    echo "[deploy] scarico l'immagine del commit $(git rev-parse --short HEAD)"
    if ! compose pull app; then
      echo "[deploy] immagine non trovata per il commit $(git rev-parse HEAD)." >&2
      echo "[deploy] Il workflow 'Image' su GitHub potrebbe essere ancora in corso: riprova tra qualche minuto." >&2
      echo "[deploy] Se l'errore parla di accesso negato, rifai 'docker login ghcr.io' (v. docs/DEPLOY.md)." >&2
      exit 1
    fi
  fi

  # Il dump va fatto prima che parta l'immagine nuova, che applica le migrazioni. Si salta solo
  # se l'app sta già girando con la stessa immagine: in quel caso lo schema non può cambiare.
  local running target running_id="" target_id=""
  running="$(compose ps -q --status running app)"
  if [ -n "$running" ]; then
    # Lo stesso nome che scripts/compose-prod.sh passa a docker compose.
    target="${MEALY_IMAGE:-ghcr.io/elverle/mealy:sha-$(git rev-parse HEAD)}"
    running_id="$(docker inspect --format '{{.Image}}' "$running")"
    target_id="$(docker image inspect --format '{{.Id}}' "$target" 2> /dev/null || true)"
  fi

  if [ -n "$running_id" ] && [ "$running_id" = "$target_id" ]; then
    echo "[deploy] l'app usa già questa immagine: nessun backup da fare"
  else
    echo "[deploy] backup prima dell'aggiornamento"
    # Bastano `db` e `backup`: se erano fermi (primo avvio, oppure dopo un `down`) partono qui.
    if ! compose up -d --wait --wait-timeout 120 db backup; then
      echo "[deploy] FALLITO: il database o il servizio di backup non partono. L'app non è stata aggiornata." >&2
      compose logs --no-log-prefix --tail 20 db backup >&2 || true
      exit 1
    fi
    if ! compose exec -T backup sh /opt/backup/backup.sh predeploy; then
      echo "[deploy] FALLITO: backup non riuscito. L'app non è stata aggiornata: controlla la cartella dei backup (BACKUP_DIR)." >&2
      exit 1
    fi
  fi

  echo "[deploy] avvio i container (le migrazioni girano all'avvio dell'app)"
  if ! compose up -d --remove-orphans --wait --wait-timeout 180; then
    echo "[deploy] FALLITO: lo stack non è diventato sano entro 180 secondi. Ultimi log dell'app:" >&2
    compose logs --no-log-prefix --tail 60 app >&2 || true
    exit 1
  fi

  local port
  port="$(compose port app 3000)"
  port="${port##*:}"
  if [ "$(curl -sS --max-time 10 "http://127.0.0.1:${port}/api/health")" != '{"status":"ok"}' ]; then
    echo "[deploy] FALLITO: /api/health non risponde sulla porta ${port}." >&2
    exit 1
  fi

  # Libera spazio: resta solo l'immagine in uso, nessuna versione precedente dell'app.
  # A questo punto il deploy è riuscito: se la pulizia fallisce basta un avviso.
  local current repo
  current="$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q app)")"
  repo="${current%:*}"
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" \
    | { grep -v -F -x -e "$current" -e "${repo}:<none>" || true; } \
    | xargs -r docker image rm > /dev/null \
    || echo "[deploy] avviso: non sono riuscito a rimuovere le immagini vecchie (il deploy è riuscito)." >&2

  echo "[deploy] fatto: Mealy risponde sulla porta ${port}"
}

main "$@"
exit $?
