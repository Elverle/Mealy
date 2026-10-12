---
title: Workflow di GitHub Actions — Gate delle Pull Request e Image (ci-workflows)
type: entity
created: 2026-10-11
updated: 2026-10-12
tags: [ci, github-actions, gate, docker, ghcr, arm64, image, smoke-test, deploy, feature-7]
---

## File e Responsabilità

- **Percorsi file**:
  - `.github/workflows/gate.yml`: workflow `Gate`, su ogni pull request. Job `gate` (già presente prima della Feature 7) e job `image` (Feature 7).
  - `.github/workflows/image.yml`: workflow `Image` (Feature 7), che costruisce l'immagine arm64 dell'app e la pubblica su GHCR.
- **Scopo**: il gate impedisce che arrivi su `main` codice che non supera `lint + typecheck + test + build` o un `Dockerfile` che non si costruisce; `Image` produce l'unica cosa che il Raspberry scarica. Il Raspberry Pi 4 da 2 GB non può costruire Next.js (requirements U1 e U2 della Feature 7).

## `Gate` (`gate.yml`)

Parte su `pull_request`. Un solo giro per ramo: `concurrency` con `cancel-in-progress` annulla quello precedente. Permessi: `contents: read`.

### Job `gate` — lint, typecheck, test, build
`ubuntu-latest`, limite 20 minuti, con un servizio `postgres:16-alpine` (utente `mealy`, database `mealy_dev`, porta 5432) e `DATABASE_URL` che lo punta. Passi: checkout, pnpm 11, Node 24 con cache pnpm, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, **`pnpm db:migrate`**, `pnpm test`, `pnpm build`.

La migrazione prima dei test non è decorativa: i test DB si saltano da soli se Postgres non risponde, e senza quel passo il gate potrebbe uscire verde senza averli eseguiti.

### Job `image` — immagine Docker e prova dello stack (Feature 7)
`ubuntu-latest` (amd64), limite 20 minuti. Passi: checkout, `docker build -t mealy-app:smoke .`, `bash scripts/smoke-prod.sh mealy-app:smoke`.

È la decisione U4: un `Dockerfile` rotto, per esempio da un aggiornamento di dipendenze, si scopre in pull request e non durante il deploy. È anche l'unico punto del gate in cui `output: 'standalone'` viene esercitato, perché la build del job `gate` non lo attiva ([[production-stack]]). I due job sono indipendenti e girano in parallelo.

## `Image` (`image.yml`)

| Aspetto | Valore |
|---|---|
| Quando parte | `push` su `main` e `workflow_dispatch` (avvio a mano) |
| Concorrenza | Gruppo `image-<ref>`, `cancel-in-progress: true` |
| Permessi | `contents: read`, `packages: write` |
| Runner | `ubuntu-24.04-arm`, limite 30 minuti |
| Immagine | `ghcr.io/elverle/mealy:sha-<sha completo del commit>` |

Passi del job `publish`:
1. checkout;
2. `docker build -t "$IMAGE" .`;
3. `bash scripts/smoke-prod.sh "$IMAGE"`: l'immagine arm64 viene provata **prima** di essere pubblicata ([[deploy-scripts]]);
4. login a GHCR con `GITHUB_TOKEN`; token e utente passano dall'ambiente del passo, non dal testo del comando;
5. `docker push "$IMAGE"`.

### Scelte e motivi

- **Runner arm64 nativo** (requirements P10): l'immagine serve a un Raspberry (`linux/arm64`) e si costruisce senza emulazione QEMU. Lo smoke prima del push prova l'immagine arm64 vera.
- **Comandi `docker` semplici**: nessuna action di terze parti da tenere aggiornata; l'unica action usata è `actions/checkout`.
- **Tag = commit, nessun `latest`** (requirements P9): è il nome che `scripts/compose-prod.sh` chiede sul Raspberry. Il nome è tutto minuscolo (`elverle`), come richiede GHCR.
- **Nessuna pulizia automatica dei pacchetti** (requirements P26): ogni push su `main` pubblica un'immagine nuova; quelle vecchie si cancellano a mano da GitHub (`docs/DEPLOY.md §10`).
- L'etichetta `org.opencontainers.image.source` del `Dockerfile` lega il pacchetto GHCR al repository.

### Cosa ne segue per il deploy

- **Il Raspberry deve aspettare `Image`.** `scripts/deploy.sh` chiede l'immagine del commit che ha appena scaricato con `git pull`: se il workflow non ha finito, il pull fallisce con `immagine non trovata per il commit …` (`docs/DEPLOY.md §6`).
- **Non ogni commit ha un'immagine.** Esiste solo per i commit che sono stati in cima a `main` con il workflow verde. Con `cancel-in-progress`, due push ravvicinati annullano la build del primo.
- **Le pull request non pubblicano nulla**: il gate costruisce un'immagine amd64 locale al runner e la butta.
- **arm64 si prova solo in `Image`**: il job `image` del gate gira su amd64.
- `workflow_dispatch` è disponibile solo per i workflow presenti sul ramo di default.

## Stato delle Verifiche

- **`Image` ha girato per la prima volta il 12 ottobre 2026**, sul branch della Feature 7 prima del merge, ed è risultato verde: runner `ubuntu-24.04-arm` disponibile per questo repository privato, build e smoke arm64 (`SMOKE OK`), login e push su GHCR. Per farlo partire sul branch il workflow aveva un trigger provvisorio su `feature/7-*`, tolto nel commit di chiusura: da quel commit gira solo su `main` e con `workflow_dispatch`.
- **I job `gate` e `image` del gate sono risultati verdi** sulla pull request #13, lo stesso giorno.
- In planning e dopo la code review i due file sono stati controllati con `actionlint` 1.7.12, pulito. `actionlint` non fa parte del gate.

## Vedi anche

- [[e6-deploy]] — Panoramica della Feature 7
- [[production-stack]] — `Dockerfile` e compose costruiti e provati dai workflow
- [[deploy-scripts]] — `smoke-prod.sh`, `compose-prod.sh` e `deploy.sh`
- [[db-bootstrap]] — Migrazioni all'avvio, provate dallo smoke
- [[fixtures-and-seed]] — Test DB del gate e seed
