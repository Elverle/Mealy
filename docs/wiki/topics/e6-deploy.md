---
title: E6 Deploy — Raspberry Pi, Immagine da GitHub Actions e Database che si Prepara da Solo
type: topic
created: 2026-10-11
updated: 2026-10-12
tags: [deploy, raspberry-pi, tailscale, docker, compose, ghcr, github-actions, bootstrap, migrations, backup, health, e6, feature-7]
---

## Panoramica

L'iniziativa **E6 Deploy** (Feature 7, story `S6.1` del backlog) porta Mealy in produzione su un Raspberry Pi 4 con Docker Compose, raggiungibile dalla rete di casa e da Tailscale. È l'Opzione C di `ARCHITECTURE §8`. Sei risultati:

1. **Database che si prepara da solo all'avvio**: in produzione l'app, prima di rispondere, aspetta Postgres, applica le migrazioni mancanti e carica gli alias degli ingredienti ([[db-bootstrap]]).
2. **Alias caricati con un upsert**: una voce corretta nel file delle fixture raggiunge anche un database già popolato ([[fixtures-and-seed]]).
3. **Endpoint di salute** `GET /api/health`, usato dal container, dallo script di deploy e dalla prova dello stack ([[health-check]]).
4. **Immagine e stack di produzione**: `Dockerfile` a più stadi con Next.js standalone e `docker-compose.prod.yml` con i servizi `app`, `db` e `backup` ([[production-stack]], [[backup-service]]).
5. **Script operativi**: un wrapper di `docker compose`, l'aggiornamento a comando singolo e la prova locale dello stack ([[deploy-scripts]]).
6. **CI**: il gate delle pull request costruisce l'immagine e prova lo stack; il workflow `Image` pubblica l'immagine arm64 su GHCR ([[ci-workflows]]).

La procedura per chi opera il Raspberry è in **`docs/DEPLOY.md`** (dieci sezioni: preparazione, primo avvio, verifica, aggiornamento, backup e ripristino, guasti). Questa wiki spiega come funzionano i pezzi e perché; per i comandi rimanda alla guida.

La feature **non aggiunge migrazioni né dipendenze**: `lib/db/schema.ts`, `package.json` e `pnpm-lock.yaml` sono invariati. Fuori da `lib/db/`, `lib/health/`, `app/api/health/`, `instrumentation.ts` e `next.config.ts` il codice applicativo non cambia; in `lib/domain/types.ts` cambia solo `IngredientAliasesFileSchema` ([[domain-types]]).

### Decisioni dell'utente (requirements 2026-10-09)

| ID | Decisione |
|---|---|
| U1 | **Hardware: Raspberry Pi 4 con 2 GB o meno.** Esclude la build di Next.js sul dispositivo; a regime app e Postgres stanno larghi |
| U2 | **L'immagine la costruisce GitHub Actions e la pubblica su GHCR; il Raspberry fa solo `pull`.** Il repository è privato: sul Raspberry servono due credenziali in sola lettura, una deploy key per `git` e un token `read:packages` per GHCR |
| U3 | **Il caricamento degli alias diventa un upsert**: inserisce i nuovi e corregge quelli il cui nome canonico è cambiato; non cancella quelli tolti dal file |
| U4 | **Il gate delle pull request costruisce l'immagine Docker** e prova lo stack di produzione: un `Dockerfile` rotto si scopre in pull request, non durante il deploy |

### Senza autenticazione: una decisione, non una lacuna

La v1 **non ha login**. È una scelta di prodotto (`ARCHITECTURE §8`, Opzione C; `CLAUDE.md`): il perimetro di sicurezza è la rete. L'app si raggiunge solo dalla LAN di casa e, fuori casa, attraverso Tailscale; nessuna porta è aperta su Internet. Login e autenticazione sono rinviati a una v2.

Conseguenze da conoscere, tutte scritte in `docs/DEPLOY.md §1`:
- l'app ascolta su tutte le interfacce del Raspberry (`HOSTNAME=0.0.0.0`) e le porte pubblicate da Docker non passano da `ufw`: in IPv4 la protegge il NAT del router di casa. Con indirizzi IPv6 pubblici va controllato che il firewall IPv6 del router blocchi le connessioni in ingresso (requirements C7);
- il traffico è **HTTP sulla porta 3000, senza TLS** (requirements P20): fuori casa lo cifra Tailscale. La review architetturale ha controllato che il codice client non usi API che richiedono un contesto sicuro (`crypto.randomUUID` compare solo in codice server; niente clipboard né service worker);
- Tailscale gira **sull'host**, non in un container (requirements P21);
- le API non sono autenticate, `GET /api/health` compresa.

## Architettura del Flusso

```
[ PC di sviluppo ]                          [ GitHub Actions ]
  pull request ───────────────────────────►  Gate
                                               ├ job gate:  lint · typecheck · test · build
                                               └ job image: docker build (amd64) + smoke-prod.sh
  merge su main ──────────────────────────►  Image (push su main · workflow_dispatch)
                                               docker build (arm64) → smoke-prod.sh → docker push
                                                          │
                                                          ▼
                                          ghcr.io/elverle/mealy:sha-<commit>
                                                          │ pull
[ Raspberry Pi 4 · /opt/mealy ]                           ▼
  bash scripts/deploy.sh
    git pull → pull dell'immagine → dump predeploy → up -d --wait → /api/health → pulizia
        │ scripts/compose-prod.sh  (--env-file .env.production, MEALY_IMAGE dal commit)
        ▼
+──────────────────── docker-compose.prod.yml · progetto mealy-prod ────────────────────+
|  app                              db                        backup                    |
|  immagine GHCR, porta 3000        postgres:16-alpine        postgres:16-alpine        |
|  instrumentation.ts               volume postgres_data      crond → backup.sh daily   |
|   └ runDbBootstrap                nessuna porta             dump in ${BACKUP_DIR}     |
|      attesa DB · migrazioni       pubblicata                                          |
|      · alias                                                                          |
|  GET /api/health ◄─ healthcheck                                                       |
+───────────────────────────────────────────────────────────────────────────────────────+
        ▲                                   ▲
  LAN di casa                         Tailscale (sull'host)
  http://<ip-del-raspberry>:3000      http://mealy:3000
```

Tre regole tengono insieme il flusso:

- **Il Raspberry non costruisce nulla e non esegue comandi `pnpm`.** Scarica l'immagine del commit che ha in `git` e la avvia. Migrazioni e alias li applica l'app.
- **Tag dell'immagine = commit** (`sha-<sha completo>`), senza tag `latest` (requirements P9). Compose, script e immagine restano allineati; se il workflow `Image` non ha finito, il pull fallisce con un messaggio invece di avviare un'immagine vecchia; tornare indietro è un `git checkout`.
- **Le ricette di esempio non entrano mai in produzione.** In produzione non gira nessun seed di ricette né di household (requirements P7): l'household di default lo crea `getDefaultHousehold()` alla prima lettura ([[household-repo]]) e la libreria parte vuota, quindi il primo *Genera piano* crea tutte le ricette con l'LLM.

## Moduli e Componenti Introdotti

### 1. Avvio e dati (`instrumentation.ts`, `lib/db/`)
- [[db-bootstrap]]: `register()` in `instrumentation.ts` e `runDbBootstrap` in `lib/db/bootstrap.ts`. Attivo solo con `NEXT_RUNTIME === 'nodejs'` e `DB_BOOTSTRAP_ON_START === 'true'`, che imposta solo il compose di produzione. In sviluppo e nei test restano `pnpm db:migrate` e `pnpm db:seed`.
- [[fixtures-and-seed]]: `seedIngredientAliases` in `lib/db/seed-core.ts` passa da `onConflictDoNothing` a `onConflictDoUpdate`; cambiano i testi di log di `lib/db/seed.ts` e `lib/db/seed-aliases.ts`.
- [[domain-types]]: `IngredientAliasesFileSchema` rifiuta gli alias duplicati.

### 2. Salute (`lib/health/`, `app/api/health/`)
- [[health-check]]: `checkDatabase(timeoutMs = 2000)` e la rotta `GET /api/health`, 200 `{"status":"ok"}` oppure 503 `db_unavailable`.

### 3. Immagine e stack (`Dockerfile`, `docker-compose.prod.yml`, `docker/backup/`)
- [[production-stack]]: `Dockerfile`, `.dockerignore`, opzione `output` di `next.config.ts`, `docker-compose.prod.yml`, `.env.production.example`, `.gitattributes`, righe nuove di `.gitignore`.
- [[backup-service]]: `docker/backup/entrypoint.sh` e `docker/backup/backup.sh`.

### 4. Script (`scripts/`)
- [[deploy-scripts]]: `scripts/compose-prod.sh`, `scripts/deploy.sh [--no-pull]`, `scripts/smoke-prod.sh <immagine>`.

### 5. CI (`.github/workflows/`)
- [[ci-workflows]]: job `image` in `gate.yml` e nuovo workflow `image.yml`.

### 6. Documenti
- `docs/DEPLOY.md`, creato dalla feature. Allineati dalla feature stessa: `README.md` (tabella dei comandi e sezione *Deploy*), `CLAUDE.md` (documenti autoritativi, stack, comandi, gate) e `ARCHITECTURE §8` (riga *Rischi/Ops* dell'Opzione C).

## Decisioni di Progetto e Loro Motivi

Gli ID rimandano a `docs/planning/feature/feature-7/requirements.md` (§3 per `P`, §8 per `C`).

| Tema | Scelta | Motivo |
|---|---|---|
| Migrazioni | All'avvio dell'app, con il migratore di `drizzle-orm` (P4, P5) | Una sola immagine senza dipendenze di sviluppo (`drizzle-kit` e `tsx` non servono sul Raspberry). Il migratore usa la stessa tabella `drizzle.__drizzle_migrations` di `drizzle-kit migrate` |
| Attesa del database | 30 tentativi ogni 2 s, poi uscita con codice 1 (P6, C3) | Dopo un riavvio dell'host Docker non rispetta `depends_on`: l'app può partire prima di Postgres. L'uscita con errore fa intervenire `restart: unless-stopped` e rende il guasto visibile a `deploy.sh` |
| Versione di Node | Node 24 Alpine, non Node 20 come nella spec (P1) | `ai` 7 richiede Node ≥ 22; il gate CI usa già Node 24 |
| Output standalone | Solo con `NEXT_OUTPUT=standalone`, impostata dal `Dockerfile` (P3) | La copia dei file tracciati crea symlink, che con pnpm su Windows possono fallire: build locale e gate restano come prima |
| Variabili d'ambiente | Elencate nel compose e interpolate da `--env-file`, non `env_file` (P12) | Il database non riceve le chiavi LLM; una variabile obbligatoria mancante ferma subito `docker compose` con un messaggio |
| Backup | Servizio sulla stessa immagine del database, rotazione a conteggio per etichetta (P13, P14) | Nessuna immagine in più e `pg_dump` sempre della versione del server. La rotazione a conteggio non cancella mai i dump buoni se i backup falliscono per giorni |
| Dump prima del deploy | Sempre, tranne quando l'app gira già con la stessa immagine (P15, C1) | Le migrazioni girano da sole e non sono reversibili: il dump è il punto di ritorno |
| Ripristino | Documentato in `docs/DEPLOY.md §7`, non uno script (P16, C6) | Operazione rara: un blocco di comandi concatenati, con gli schemi azzerati e il dump caricato in una transazione unica |
| Runner della build | `ubuntu-24.04-arm`, comandi `docker` semplici (P10) | Runner arm64 nativo, senza emulazione; nessuna action di terze parti da tenere aggiornata oltre al checkout |
| Limiti di memoria | Nessuno (P12) | Un limite che uccide l'app durante una generazione farebbe più danno di nessun limite |
| `maxDuration` e timeout | Invariati (P23) | In self-host `maxDuration` è ignorata; non c'è un proxy davanti all'app ([[plan-service]], [[recipe-generation]]) |

### Scostamenti dalla spec

`docs/planning/feature/feature-7/spec.md` è stata scritta prima di conoscere l'hardware. Il codice segue il piano, non la spec:

| Spec | Codice |
|---|---|
| `node:20-alpine` | `node:24-alpine` |
| Build sul Raspberry (`up -d --build`) | Build in GitHub Actions, `pull` dal Raspberry |
| `pnpm db:migrate` nel container | Migrazioni all'avvio dell'app |
| Variabili da `env_file: .env.production` | Interpolazione da `--env-file .env.production` |
| Rimozione dei dump più vecchi di 7 giorni | Ultimi 7 dump per etichetta |
| Il runner copia `public/` | Non copiata: la cartella non esiste |

## Stato delle Verifiche

Il 12 ottobre 2026 il branch è stato pubblicato e la pull request #13 aperta: i tre controlli su GitHub sono risultati verdi al primo tentativo (commit `ee4b134`).

| Cosa | Stato |
|---|---|
| Build dell'immagine (amd64, Docker Desktop su Windows) | Verificata in locale |
| `scripts/smoke-prod.sh` (`SMOKE OK`) | Verificato in locale |
| Sequenza di `scripts/deploy.sh --no-pull`: primo avvio, seconda esecuzione con la stessa immagine, immagine diversa, backup che fallisce, pulizia che fallisce | Verificata in locale |
| Ripristino di `docs/DEPLOY.md §7`, con dump buono e con dump corrotto | Verificato in locale |
| Gate completo: `lint`, `typecheck`, `build`, `test` con **84 file e 1143 test** | Verde in locale |
| Workflow `Image`: runner arm64, build e prova dell'immagine arm64, login e push su GHCR | Verde su GitHub: runner `ubuntu-24.04-arm`, `SMOKE OK` sull'immagine arm64, immagine pubblicata con il tag del commit |
| Job `gate` e `image` del gate su GitHub | Verdi sulla pull request #13 |
| Tutto ciò che gira sul Raspberry: preparazione, `git pull` e pull dell'immagine, accesso da LAN e da Tailscale, generazione LLM dal Raspberry, backup notturno alle 03:00, riavvio dell'host | **Non verificato** (a carico dell'utente, `docs/DEPLOY.md §5`) |

Non provati nemmeno in locale: l'esclusione delle immagini senza tag nella pulizia di `deploy.sh`, il ramo d'errore dello smoke quando nel database ci sono ricette, il ramo d'errore di `tests/db/bootstrap.test.ts` quando il database di sviluppo è indietro di una migrazione.

## Contratti per Chi Sviluppa Dopo

- **Una migrazione arrivata su `main` non si modifica: se ne aggiunge una nuova** (`pnpm db:generate`). Il migratore confronta solo l'orario dell'ultima migrazione applicata ([[db-bootstrap]]). La migrazione nuova arriva in produzione al deploy successivo, applicata dall'app.
- **Una voce di `fixtures/ingredient-aliases.json`** aggiunta o corretta arriva in produzione al deploy successivo. Una voce **tolta** dal file resta nel database.
- **Una variabile d'ambiente nuova per l'app** va aggiunta in tre posti: `environment` del servizio `app` in `docker-compose.prod.yml` (le variabili sono elencate una per una), `.env.production.example` e la tabella di `docs/DEPLOY.md §3.5`.
- **Il corpo di `GET /api/health` è un contratto**: `deploy.sh` e `smoke-prod.sh` lo confrontano carattere per carattere con `{"status":"ok"}` ([[health-check]]).
- **La riga di log `alias inseriti o aggiornati: 0`** è cercata da `smoke-prod.sh` dopo il riavvio dell'app ([[db-bootstrap]], [[deploy-scripts]]).
- **Cartella `public/`**: oggi non esiste e il `Dockerfile` non la copia. Se viene creata serve una riga `COPY` nello stadio `runner` (`docs/DEPLOY.md §10`).
- **v2**: login e autenticazione. L'Opzione A (Vercel + Neon) resta l'alternativa cloud: schema e ORM sono Postgres standard (`ARCHITECTURE §8`).

### Esito dei contratti delle feature precedenti

- **Feature 6** ([[e4-lista-spesa]]) chiedeva al deploy di eseguire `pnpm db:migrate` e poi `pnpm db:seed:aliases`, mai `pnpm db:seed`. La regola di fondo è rispettata (migrazioni, poi alias, nessuna ricetta di esempio), ma **senza comandi**: i due passi li fa `runDbBootstrap` all'avvio dell'app. `pnpm db:seed:aliases` resta un comando di sviluppo.
- **Limite "`pnpm db:seed:aliases` inserisce soltanto"** della Feature 6: chiuso dall'upsert (U3). Resta aperto solo il caso della voce tolta dal file.
- **Feature 5** ([[e2-libreria-preferenze]]) annotava "una migrazione in più (`0004`), applicata dallo stesso `pnpm db:migrate`": in produzione la applica il bootstrap, insieme alle altre quattro.

## Punti Aperti e Limiti Noti

- **Un alias tolto dal file non viene cancellato** dal database. La cancellazione è esclusa perché i test DB inseriscono alias propri nella stessa tabella (requirements U3).
- **Le migrazioni non tornano indietro.** Tornare a una versione precedente dopo un cambio di schema richiede il `git checkout` e il ripristino del dump `predeploy` fatto prima dell'aggiornamento (`docs/DEPLOY.md §6`). `deploy.sh` non fa nessun ritorno indietro da solo: se un passo fallisce si ferma e lo dice.
- **Il migratore decide per orario, non per elenco**: una voce del journal con un orario più vecchio dell'ultima applicata verrebbe saltata in silenzio. Lo copre un test sul journal ([[db-bootstrap]]).
- **`GET /api/health` prova solo `select 1`**: un'app con lo schema indietro di una migrazione risulta sana ([[health-check]]).
- **Il modulo delle ricette di esempio è nell'immagine di produzione.** `lib/db/bootstrap.ts` importa `seed-core.ts`, che contiene anche `seedDatabase` e importa le ricette di `fixtures/recipes.json`: vengono validate a ogni avvio, ma `seedDatabase` non viene chiamata. Lo smoke fallisce se trova ricette nel database ([[deploy-scripts]]).
- **Backup sulla stessa microSD del database**, di default: un guasto della scheda perde entrambi. La guida consiglia un disco USB o una copia su un altro computer (requirements P17).
- **Sul Raspberry resta solo l'immagine in uso**: tornare indietro richiede la rete e un token GHCR valido. Il token ha una scadenza scelta dall'utente.
- **Le immagini su GHCR si accumulano**: una per ogni push su `main`, cancellazione a mano (requirements P26).
- **`DATABASE_URL` assente**: app e bootstrap ripiegano sull'URL di sviluppo (`localhost`) invece di fermarsi con un messaggio. Il compose di produzione la imposta sempre.
- **`next lint` non guarda la radice, `tests/` e `scripts/`**: `instrumentation.ts` non passa dal lint, solo dal typecheck. Rinviato agli aggiornamenti di dipendenze (review architetturale, P5).
- **Aggiornamenti di dipendenze e Dependabot**: fuori da questa feature per decisione dell'utente (requirements P25).
- **Tempi sul Raspberry non misurati**: la durata del primo piano con libreria vuota, le letture complete di libreria e lista annotate in [[e2-libreria-preferenze]] ed [[e4-lista-spesa]].

## Strategia di Test

I file di test passano da 80 a **84**, i test a **1143**. Nuovi file:
- `tests/db/bootstrap.test.ts`: ordine del journal (senza database), database irraggiungibile, database già allineato, database usa-e-getta fermo alla migrazione precedente;
- `tests/instrumentation.test.ts`: le condizioni di attivazione di `register()`, il log e l'uscita con codice 1;
- `tests/health/service.test.ts` e `tests/api/health.test.ts`: servizio e rotta di salute.

Adeguati: `tests/db/seed.test.ts` (correzione di un alias con nome canonico cambiato, in una transazione annullata), `tests/domain/generation-contracts.test.ts` (alias duplicato rifiutato), `tests/plans/service.test.ts` (solo il limite di tempo dei test, portato a 15 s: nella suite completa i 5 s di default non bastavano sempre).

`Dockerfile`, compose e script di shell non hanno test Vitest: li prova `scripts/smoke-prod.sh`, che gira in locale, nel job `image` del gate e nel workflow `Image` prima del push ([[deploy-scripts]], [[ci-workflows]]). I test restano senza rete: quelli del bootstrap usano il Postgres locale e una porta chiusa di `127.0.0.1`.

I criteri di accettazione della spec che dipendono dal Raspberry (accesso da LAN e da Tailscale, generazione LLM, riavvio dell'host) non hanno una prova nel repository: si verificano con `docs/DEPLOY.md §5`.

## Vedi anche

- [[db-bootstrap]] — `register()` e `runDbBootstrap`: attesa del database, migrazioni e alias all'avvio
- [[health-check]] — `checkDatabase` e `GET /api/health`
- [[production-stack]] — `Dockerfile`, compose di produzione e variabili d'ambiente
- [[backup-service]] — Dump compressi, etichette e rotazione
- [[deploy-scripts]] — `compose-prod.sh`, `deploy.sh` e `smoke-prod.sh`
- [[ci-workflows]] — Gate delle pull request e workflow `Image`
- [[fixtures-and-seed]] — Alias in upsert e comandi di seed
- [[database-architecture]] — Ambienti del database e flusso delle migrazioni
- [[database-schema]] — Tabelle e migrazioni `0000`–`0004`
- [[household-repo]] — `getDefaultHousehold`, che crea l'household alla prima lettura
- [[e4-lista-spesa]] — Feature 6: alias letti dalla lista della spesa e contratto per il deploy
- [[e0-fondamenta]] — Feature 1: schema, migrazioni e Postgres di sviluppo
