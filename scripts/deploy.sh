#!/usr/bin/env bash
# Aggiorna Mealy sul server: codice, immagine, backup, riavvio, verifica.
# Uso: bash scripts/deploy.sh [--build | --no-pull]
#   (nessuna opzione)  `git pull`, poi scarica l'immagine del commit pubblicata dal workflow Image.
#   --build    `git pull`, poi costruisce l'immagine su questa macchina con `docker build`
#              (se esiste già per quel commit la riusa). Non serve né GitHub Actions né GHCR.
#   --no-pull  non esegue `git pull` né scarica o costruisce l'immagine: riapplica la configurazione
#              (per esempio dopo una modifica a .env.production) con ciò che c'è già in locale.
# Il nome dell'immagine lo calcola scripts/image-name.sh.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

compose() {
  bash scripts/compose-prod.sh "$@"
}

# Tutto in una funzione: bash la legge per intero prima di eseguirla, quindi `git pull`
# può aggiornare questo file senza disturbare l'esecuzione in corso.
main() {
  local mode=pull
  case "${1:-}" in
    "") ;;
    --build) mode=build ;;
    --no-pull) mode=local ;;
    *)
      echo "Argomento sconosciuto: $1. Uso: bash scripts/deploy.sh [--build | --no-pull]" >&2
      exit 2
      ;;
  esac

  if [ "$mode" != local ]; then
    echo "[deploy] aggiorno il codice"
    git pull --ff-only
  fi

  # Il nome dipende dal commit: va calcolato dopo `git pull`. Esportato, compose-prod.sh usa lo stesso.
  local image
  image="$(bash scripts/image-name.sh)"
  export MEALY_IMAGE="$image"

  if [ "$mode" = pull ]; then
    echo "[deploy] scarico l'immagine ${image}"
    if ! compose pull app; then
      echo "[deploy] immagine non trovata per il commit $(git rev-parse HEAD)." >&2
      echo "[deploy] Il workflow 'Image' su GitHub potrebbe essere ancora in corso: riprova tra qualche minuto." >&2
      echo "[deploy] Se l'errore parla di accesso negato, rifai 'docker login ghcr.io' (v. docs/DEPLOY.md)." >&2
      echo "[deploy] Se non usi il workflow 'Image', costruisci l'immagine qui: bash scripts/deploy.sh --build" >&2
      exit 1
    fi
  elif [ "$mode" = build ]; then
    if docker image inspect "$image" > /dev/null 2>&1; then
      echo "[deploy] l'immagine ${image} c'è già: la riuso"
    else
      echo "[deploy] costruisco l'immagine ${image} (può richiedere diversi minuti)"
      if ! docker build -t "$image" .; then
        echo "[deploy] FALLITO: la build dell'immagine non è riuscita. L'app non è stata aggiornata." >&2
        exit 1
      fi
    fi
  fi

  # Il dump va fatto prima che parta l'immagine nuova, che applica le migrazioni. Si salta solo
  # se l'app sta già girando con la stessa immagine: in quel caso lo schema non può cambiare.
  local running running_id="" target_id=""
  running="$(compose ps -q --status running app)"
  if [ -n "$running" ]; then
    running_id="$(docker inspect --format '{{.Image}}' "$running")"
    target_id="$(docker image inspect --format '{{.Id}}' "$image" 2> /dev/null || true)"
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
