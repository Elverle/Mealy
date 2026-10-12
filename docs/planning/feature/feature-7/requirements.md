# Feature 7 — E6 Deploy: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Story: `docs/BACKLOG.md` S6.1. Spec: `spec.md` di questa cartella. Riferimenti: `docs/ARCHITECTURE.md §7, §8`, `docs/planning/execution-strategy.md §3 Feature 7 e §4`, nota della Feature 6 in `docs/planning/feature-index.md` (limite di `db:seed:aliases`).

## 1. Layout e identità

- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-7/`.
- **Titolo**: Feature 7 — E6 Deploy (Raspberry Pi + Tailscale).
- **Prerequisiti**: Feature 1–6 e il fix `fix/lista-ordine-stabile` in `main` (v0.5.1, commit `9bc43b5`). Vale "il codice reale vince".
- **Chi fa cosa**: la pipeline prepara nel repo codice, immagine, compose, script, CI e guida. Il Raspberry (Docker, Tailscale, chiavi, `.env.production`, primo avvio) lo prepara l'utente seguendo `docs/DEPLOY.md`: l'elenco è al §6.

## 2. Decisioni prese con l'utente (2026-10-09)

| # | Decisione | Motivo |
|---|---|---|
| U1 | **Hardware: Raspberry Pi 4 con 2 GB o meno** | Dato di fatto. Esclude la build di Next.js sul dispositivo (lint, typecheck e build superano la memoria disponibile); a regime app e Postgres stanno larghi |
| U2 | **L'immagine la costruisce GitHub Actions e la pubblica su GHCR; il Raspberry fa solo `pull`** | Conseguenza di U1. Cambia la spec (FR-5, che prevedeva `docker compose build` sul Pi): sul Pi restano `git pull` (compose, script) e il pull dell'immagine. Repo privato ⇒ sul Pi servono due credenziali in sola lettura: deploy key per git, token `read:packages` per GHCR |
| U3 | **Il caricamento degli alias diventa un upsert** (inserisce i nuovi, corregge quelli il cui nome canonico è cambiato; non cancella quelli tolti dal file) | Chiude il limite annotato alla Feature 6, che in produzione sarebbe scattato a ogni deploy. La cancellazione è esclusa perché i test DB inseriscono alias propri nella stessa tabella (F6 P24) |
| U4 | **Il gate CI delle pull request costruisce l'immagine Docker** e prova lo stack di produzione | Un Dockerfile rotto (per esempio dagli aggiornamenti di dipendenze previsti a fine v1) si scopre in PR, non durante il deploy |

## 3. Decisioni prese in planning (motivate)

| # | Decisione | Motivo |
|---|---|---|
| P1 | **Node 24 Alpine**, non Node 20 come nella spec | `ai` 7.0.102 dichiara `engines.node >= 22`; il gate CI usa già Node 24 |
| P2 | **pnpm fissato a 11.14.0** nell'immagine (`npm install -g`), non corepack | `package.json` non ha `packageManager`; 11.14.0 è la versione in uso in locale, il CI usa la 11. Nessuna dipendenza dal corepack della versione di Node |
| P3 | **`output: 'standalone'` solo con `NEXT_OUTPUT=standalone`**, impostata dal Dockerfile | La copia dei file tracciati crea symlink: con pnpm su Windows può fallire e romperebbe il gate locale. Build locale e CI restano identiche a oggi |
| P4 | **Migrazioni e alias all'avvio dell'app**, da `instrumentation.ts` → `lib/db/bootstrap.ts`, attive solo con `DB_BOOTSTRAP_ON_START=true` (impostata dal compose di produzione) | Una sola immagine senza dipendenze di sviluppo (`drizzle-kit`, `tsx` non servono sul Pi) e nessun comando `pnpm` in produzione. Verificato sul prototipo: le richieste restano in attesa finché il bootstrap non finisce (FR-2). In sviluppo e nei test non cambia nulla: restano `pnpm db:migrate` e `pnpm db:seed` |
| P5 | **Migratore di `drizzle-orm`** (`drizzle-orm/postgres-js/migrator`) | Usa la stessa tabella `drizzle.__drizzle_migrations` di `drizzle-kit migrate`. Verificato: sul DB di sviluppo, migrato con drizzle-kit, i `created_at` coincidono con il journal e il migratore non applica nulla |
| P6 | Il bootstrap usa **una connessione propria** (chiusa alla fine) e **ritenta la connessione 30 volte ogni 2 s** (con l'attesa crescente di postgres-js disattivata: v. §8, C3); se fallisce, log d'errore e `process.exit(1)` | Dopo un riavvio dell'host Docker non rispetta `depends_on`: l'app può partire prima di Postgres. L'uscita con errore fa intervenire `restart: unless-stopped` e rende visibile il guasto a `deploy.sh` |
| P7 | **In produzione nessun seed di ricette né di household** | `getDefaultHousehold()` crea il singleton alla prima lettura; le ricette di esempio non devono mai entrare in produzione (README, CLAUDE.md). La libreria parte vuota: il primo piano genera tutte le ricette con l'LLM |
| P8 | **`GET /api/health`**: 200 `{"status":"ok"}` se il DB risponde a `select 1` entro 2 s, altrimenti 503 `db_unavailable` | Serve a healthcheck del container, `deploy.sh` e smoke test (FR-5). Servizio in `lib/health/service.ts`, come le altre rotte che passano da un servizio |
| P9 | **Tag dell'immagine = commit**: `ghcr.io/elverle/mealy:sha-<sha completo>`; nessun tag `latest`. `scripts/compose-prod.sh` ricava il tag da `git rev-parse HEAD` | Codice (compose, script) e immagine restano sempre allineati; se il workflow non ha ancora finito, il pull fallisce con un messaggio chiaro invece di avviare un'immagine vecchia; il rollback è un `git checkout` |
| P10 | **Workflow `Image`**: push su `main` e `workflow_dispatch` (più `feature/7-*` finché la feature è in sviluppo: trigger provvisorio, tolto nel commit di chiusura), runner `ubuntu-24.04-arm`, comandi `docker` semplici (login, build, smoke, push) | Runner arm64 nativo, disponibile anche nei repo privati (v. §5): niente emulazione QEMU. Lo smoke prima del push prova l'immagine arm64 vera. Nessuna action di terze parti da tenere aggiornata |
| P11 | **Job `image` nel gate**: build amd64 + `scripts/smoke-prod.sh` | Lo stesso script serve in locale, nel gate e nel workflow `Image` |
| P12 | **Compose di produzione**: variabili dell'app elencate in `environment` con interpolazione da `--env-file .env.production`; `POSTGRES_PASSWORD`, `LLM_MODEL` e `MEALY_IMAGE` obbligatorie; Postgres senza porte pubblicate; log con rotazione (10 MB × 3); progetto `mealy-prod`; nessun limite di memoria | Il DB non riceve le chiavi LLM; una variabile mancante ferma subito `docker compose` con un messaggio. La rotazione dei log protegge la microSD. Un limite di memoria che uccide l'app durante una generazione farebbe più danno di nessun limite |
| P13 | **Backup**: servizio `backup` sulla stessa immagine `postgres:16-alpine`, `crond` di busybox, script montati da `docker/backup/` | Nessuna immagine in più da costruire e `pg_dump` sempre della versione del server. Verificato: `crond` c'è, eredita le variabili d'ambiente del container, `tzdata` è presente |
| P14 | **Rotazione a conteggio, per etichetta** (`BACKUP_KEEP`, default 7), eseguita solo dopo un dump riuscito e verificato (`gzip -t`) | FR-3 chiede "gli ultimi 7 dump". A differenza della rotazione per età, non cancella mai i dump buoni se i backup falliscono per giorni. Le etichette (`daily`, `predeploy`, `manual`) non si cancellano a vicenda |
| P15 | **Dump prima di ogni cambio di immagine** (`predeploy`) in `deploy.sh`; se il dump non riesce lo script si ferma (v. §8, C1) | Le migrazioni girano da sole all'avvio e non sono reversibili: il dump è il punto di ritorno |
| P16 | **Ripristino documentato**, non uno script | Un blocco di comandi concatenati: azzeramento degli schemi e dump in una transazione unica, dopo un dump dello stato corrente. Provato l'11 ottobre anche con oggetti creati dopo il dump. Uno script in più sarebbe codice da mantenere per un'operazione rara |
| P17 | **Cartella dei backup configurabile** (`BACKUP_DIR`, default `./backups` nel repo) | Sulla stessa microSD del DB un guasto perde entrambi: la guida consiglia un altro disco o una copia fuori dal Pi, ma la scelta è dell'utente |
| P18 | **`deploy.sh`**: `git pull --ff-only` → pull dell'immagine → dump `predeploy` (saltato solo se l'app gira già con la stessa immagine) → `up -d --wait` → controllo di `/api/health` → rimozione delle immagini dell'app non più in uso (se fallisce, solo un avviso). Opzione `--no-pull` | FR-5. `--no-pull` serve a riapplicare `.env.production` e rende lo script provabile in locale. Il corpo sta in una funzione `main` perché `git pull` può riscrivere lo script mentre gira |
| P19 | **Script invocati con `bash …` / `sh …`**, fine riga LF imposta da `.gitattributes` | Su Windows non si può contare sul bit di esecuzione; uno script con CRLF montato nel container fallirebbe |
| P20 | **HTTP sulla porta 3000, senza TLS né `tailscale serve`** | Così la spec. Verificato: il codice client non usa API che richiedono un contesto sicuro (`crypto.randomUUID`, clipboard, service worker); il traffico fuori casa è già cifrato da Tailscale |
| P21 | **Tailscale sull'host**, non in un container | Così la spec (§4.1): un solo demone per tutto il Pi, niente rete `host` né capability speciali nei container |
| P22 | **Il Dockerfile non copia `public/`** | La cartella non esiste nel repo. Se un giorno verrà creata, va aggiunta una riga `COPY` (annotato nella guida) |
| P23 | **Nessuna modifica a `maxDuration` e ai timeout** | In self-host `maxDuration` è ignorata; non c'è un proxy davanti e il server HTTP di Node non ha timeout sulla risposta |
| P24 | **Cartella d'installazione sul Pi: `/opt/mealy`** | Così la spec (§4.1) |
| P25 | **Nessun aggiornamento di dipendenze** in questa feature | Decisione dell'utente del 2026-10-09: Dependabot e bump dopo la Feature 7 |
| P26 | **Nessuna pulizia automatica dei pacchetti GHCR** | Lo storage delle immagini su GHCR è al momento gratuito; la pulizia a mano è annotata nella guida. Un'action di cancellazione aggiungerebbe permessi e rischio per un problema che oggi non c'è |
| P27 | `SeedReport.aliasesInserted` **mantiene il nome**; cambia solo il commento | Rinominarlo toccherebbe `seed.ts`, i test e la wiki senza cambiare il comportamento |
| P28 | **Wiki fuori dai work package** | La aggiorna `feature-documenter` in chiusura di `/feature-dev` (v. §7). I WP scrivono solo `docs/DEPLOY.md` e allineano `README.md`, `CLAUDE.md`, `ARCHITECTURE.md §8` |

## 4. Scostamenti dalla spec

| Spec | Piano | Decisione |
|---|---|---|
| `node:20-alpine` | `node:24-alpine` | P1 |
| Build sul Raspberry (`up -d --build`) | Build in GitHub Actions, pull dal Pi | U1, U2 |
| `pnpm db:migrate` nel container | Migrazioni all'avvio dell'app | P4, P5 |
| Variabili da `env_file: .env.production` | Interpolazione da `--env-file .env.production` | P12 |
| Retention "più vecchi di 7 giorni" | Ultimi 7 dump per etichetta | P14 |
| Runner copia `public/` | Non copiata (non esiste) | P22 |
| Utente `nextjs` | Confermato: `nextjs:nodejs` (uid/gid 1001) | — |

## 5. Verifiche fatte in planning (prototipo fuori dal repo, 2026-10-09)

Una copia di `main` nello scratchpad, con i file del piano, costruita ed eseguita su Docker Desktop (amd64, Windows + Git Bash):

- `docker build`: riuscita in 4 min 44 s; immagine finale 233 MB; utente `nextjs`; `lib/db/migrations` presente.
- Next 15.5.25 traccia `instrumentation.ts` nello standalone (`copyTracedFiles` legge `instrumentation.js.nft.json`): il migratore di drizzle entra nell'immagine senza configurazione aggiuntiva.
- Stack avviato da zero: 5 migrazioni applicate, 35 alias caricati, `pg_trgm` presente, `/api/health` 200, pagina iniziale 200 (redirect a `/benvenuto`), CSS e font serviti.
- DB spento all'avvio dell'app: il bootstrap ritenta, le richieste restano in attesa (nessuna risposta prima della fine), l'app riparte da sola quando il DB torna; secondo avvio: 0 alias scritti.
- Backup: 3 dump con `BACKUP_KEEP=2` ⇒ restano 2; etichetta non valida ⇒ uscita 2; DB spento ⇒ uscita 1, nessun file parziale, dump esistenti intatti; ripristino provato sullo stesso schema (prova poi risultata insufficiente: la architecture review dell'11 ottobre ha portato al ripristino con azzeramento degli schemi, P16).
- `scripts/smoke-prod.sh`: `SMOKE OK` in 43 s. `scripts/deploy.sh --no-pull`: primo e secondo avvio, dump `predeploy`, rimozione dell'immagine vecchia.
- Sulla copia: `pnpm typecheck` pulito, `pnpm lint` pulito, `pnpm test` 84 file / 1139 test verdi, `pnpm build` verde senza cartella `standalone`.
- Solo `/_not-found` è prerenderizzata: la build nell'immagine non ha bisogno del database.
- I blocchi di codice di `plan.md` sono stati riestratti dal piano e rieseguiti così come sono scritti: build dell'immagine, `SMOKE OK`, sequenza di accettazione di `deploy.sh`, `actionlint` pulito su `gate.yml` (con il job `image`) e `image.yml`. Non eseguiti perché sono solo testo: `.env.production.example` e `docs/DEPLOY.md`.
- Runner `ubuntu-24.04-arm` nei repo privati: confermato dalla documentazione GitHub (2 vCPU, 8 GB), i minuti si scalano dalla quota del piano. **Non provato su questo repo**: il workflow `Image` gira per la prima volta al push del branch `feature/7-*`, prima del merge, grazie al trigger provvisorio (P10). Esito: verde il 12 ottobre 2026 (build e smoke arm64, push su GHCR); il ripiego non è servito. Ripiego se la label non fosse disponibile per l'account: `runs-on: ubuntu-latest` + `docker/setup-qemu-action@v4` + `docker buildx build --platform linux/arm64 --push` (più lento, senza smoke arm64).
- Non provato: la build e l'esecuzione arm64 (le prova il workflow `Image`) e tutto ciò che dipende dal Raspberry e da Tailscale (§6).

## 6. A carico dell'utente sul Raspberry (non sono work package)

Dettaglio dei comandi in `docs/DEPLOY.md` (scritto dal WP5).

1. Raspberry Pi OS a 64 bit, Docker con il plugin Compose, utente nel gruppo `docker`.
2. Tailscale sul Pi (`--hostname=mealy`) e sul telefono; scadenza della chiave disattivata per il Pi.
3. Deploy key in sola lettura sul repo GitHub; clone in `/opt/mealy`.
4. Token classico GitHub con il solo scope `read:packages`; `docker login ghcr.io`.
5. `.env.production` da `.env.production.example`: `POSTGRES_PASSWORD`, provider, modello e chiave LLM.
6. Dopo il merge in `main`: attendere il workflow `Image`, poi `bash scripts/deploy.sh`.
7. Verifica dei criteri che il repo non può provare: AC-3 (LAN), AC-4 (telefono fuori casa via Tailscale), AC-5 (generazione LLM dal Pi), AC-7 (`sudo reboot`), più AC-1 su arm64 e AC-6 sul Pi.

## 7. Per la chiusura di `/feature-dev 7`

- **Prima del commit di chiusura**: push del branch e pull request, su conferma dell'utente; job `image` del gate e workflow `Image` verdi sul branch.
- **Nel commit di chiusura**: togliere `'feature/7-*'` e le righe di commento sopra da `.github/workflows/image.yml`; `actionlint` pulito. Da quel commit in poi `Image` non gira più sul branch: l'ultima prova arm64 prima del merge è quella del commit precedente.
- **Wiki** (`feature-documenter`): nuovo topic `e6-deploy`; entità per `bootstrap`, `health`, stack di produzione e script; aggiornare `docs/wiki/entities/fixtures-and-seed.md` (da "inserisce soltanto" a upsert, limite chiuso).
- **`feature-index.md`**: il limite noto della nota di Feature 6 è chiuso da U3; resta aperto solo "un alias tolto dal file non viene cancellato".
- **Dipendenze**: riproporre all'utente Dependabot e gli aggiornamenti (P25), dopo il merge.
- **Prove da telefono**: restano solo quelle che dipendono dal Raspberry e da Tailscale (§6 punto 7).

## 8. Decisioni dalla code review (2026-10-11)

Prese dopo `/feature-review 7`, su richiesta dell'utente di correggere tutti i rilievi. Dettaglio in `plan.md`, "Correzioni dalla code review".

| # | Decisione | Motivo |
|---|---|---|
| C1 | `deploy.sh` fa **sempre** il dump `predeploy`, dopo aver avviato `db` e `backup`. Lo salta solo se l'app sta già girando con la stessa immagine (confronto degli ID) | Prima il dump dipendeva dal servizio `backup` in esecuzione: dopo un `down`, o con il backup in errore, lo script migrava senza punto di ritorno. Saltarlo a immagine invariata evita che le riesecuzioni con `--no-pull` facciano uscire dalla rotazione il dump con lo schema precedente |
| C2 | La pulizia delle immagini vecchie in `deploy.sh` **non è fatale** e ignora le immagini senza tag | A quel punto il deploy è riuscito: un errore di `docker image rm` non deve farlo sembrare fallito |
| C3 | Il bootstrap disattiva l'attesa crescente di postgres-js (`backoff: () => 0`) | Con il valore predefinito i 30 tentativi "ogni 2 s" di P6 diventavano 6–7 minuti |
| C4 | `IngredientAliasesFileSchema` rifiuta gli **alias duplicati** | Con l'upsert di U3 un duplicato nelle fixture fa fallire l'`INSERT` e, in produzione, l'avvio. Lo schema dà un messaggio leggibile già al caricamento delle fixture |
| C5 | Un test applica l'ultima migrazione a un **database usa-e-getta** fermo a quella precedente | È il percorso che ogni nuova migrazione farà sul Raspberry e che nessuna prova copriva. Il database di sviluppo non viene toccato |
| C6 | Il ripristino della guida è **concatenato con `&&`** e preceduto da un dump `manual` | Incollato per intero, il blocco di prima proseguiva anche dopo un `gzip -t` fallito |
| C7 | La guida segnala il caso **IPv6** e che Docker scavalca `ufw` | L'app è senza login per scelta (Opzione C): "nessuna porta su Internet" vale solo dietro il NAT IPv4 |
