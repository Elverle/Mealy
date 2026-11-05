#!/usr/bin/env bash
# Stampa il nome dell'immagine dell'app per il commit in uso. Lo usano compose-prod.sh e deploy.sh.
# In ordine:
#   1. MEALY_IMAGE, se impostata: il nome completo, così com'è;
#   2. MEALY_IMAGE_REPO (variabile d'ambiente oppure riga in .env.production) + ":sha-<commit>";
#   3. ghcr.io/<proprietario del remote origin su GitHub, in minuscolo>/mealy:sha-<commit>,
#      cioè il nome che pubblica il workflow Image di quel repository;
#   4. se origin non è un repository GitHub: mealy:sha-<commit>, un nome solo locale
#      (va bene con `bash scripts/deploy.sh --build`).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -n "${MEALY_IMAGE:-}" ]; then
  printf '%s\n' "$MEALY_IMAGE"
  exit 0
fi

if ! sha="$(git rev-parse HEAD 2> /dev/null)"; then
  echo "Non riesco a leggere il commit con git: lancia lo script dalla copia clonata del repository, senza sudo, oppure imposta MEALY_IMAGE." >&2
  exit 1
fi

repo="${MEALY_IMAGE_REPO:-}"
env_file="${MEALY_ENV_FILE:-.env.production}"
if [ -z "$repo" ] && [ -f "$env_file" ]; then
  # Ultima riga MEALY_IMAGE_REPO=..., senza virgolette né ritorno a capo di Windows.
  repo="$(sed -n 's/^MEALY_IMAGE_REPO=//p' "$env_file" | tail -n 1 | tr -d "\"'\r")"
fi

if [ -z "$repo" ]; then
  url="$(git remote get-url origin 2> /dev/null || true)"
  # https://github.com/<owner>/<repo>(.git) oppure git@github.com:<owner>/<repo>(.git)
  owner="$(printf '%s\n' "$url" | sed -nE 's#^.*github\.com[:/]+([^/]+)/[^/]+/?$#\1#p')"
  if [ -n "$owner" ]; then
    repo="ghcr.io/$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')/mealy"
  else
    repo="mealy"
  fi
fi

printf '%s:sha-%s\n' "$repo" "$sha"
